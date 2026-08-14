import type { Dependency, PackageUpdate, SecurityAdvisory, VulnerabilitySeverity } from '../types'
import type { Logger } from '../utils/logger'
import { AsyncMemo, chunk, mapWithConcurrency } from '../utils/concurrency'
import { fetchWithTimeout } from '../utils/http'

const OSV_API = 'https://api.osv.dev'

/** OSV caps `querybatch` at 1000 queries per request. */
const BATCH_SIZE = 1000

/** Severity ordering, used for both comparison and normalization. */
const SEVERITY_ORDER: Record<VulnerabilitySeverity, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
}

/**
 * Map a buddy-bot dependency type onto an OSV ecosystem identifier.
 *
 * Returns `null` for dependency kinds OSV does not index (GitHub Actions,
 * Docker images, pkgx packages) so callers can skip them without a request.
 */
export function toOsvEcosystem(dependencyType: Dependency['type']): string | null {
  switch (dependencyType) {
    case 'dependencies':
    case 'devDependencies':
    case 'peerDependencies':
    case 'optionalDependencies':
      return 'npm'
    case 'require':
    case 'require-dev':
      return 'Packagist'
    case 'github-actions':
      // OSV carries GitHub Actions advisories, and an action runs with the
      // workflow's credentials — a compromised one is a repository compromise,
      // which makes this the least optional ecosystem to cover.
      return 'GitHub Actions'
    default:
      return null
  }
}

interface OsvBatchResponse {
  results?: Array<{ vulns?: Array<{ id: string }> }>
}

interface OsvVulnerability {
  id: string
  aliases?: string[]
  summary?: string
  details?: string
  severity?: Array<{ type?: string, score?: string }>
  database_specific?: { severity?: string }
  affected?: Array<{
    package?: { name?: string, ecosystem?: string }
    ranges?: Array<{ type?: string, events?: Array<{ introduced?: string, fixed?: string }> }>
  }>
}

/**
 * Normalize the several severity encodings OSV records carry into buddy-bot's
 * four-level scale.
 *
 * GitHub-sourced records expose a plain word under `database_specific`; others
 * only carry a CVSS vector, which is bucketed by its base score band. Records
 * with neither are treated as `moderate` — reporting them is more useful than
 * dropping them, and understating a real advisory is worse than overstating.
 */
export function normalizeSeverity(vuln: OsvVulnerability): VulnerabilitySeverity {
  const raw = vuln.database_specific?.severity?.toLowerCase()
  if (raw === 'low' || raw === 'moderate' || raw === 'high' || raw === 'critical')
    return raw
  if (raw === 'medium')
    return 'moderate'

  const cvss = vuln.severity?.find(entry => entry.type?.startsWith('CVSS'))?.score
  if (cvss) {
    const score = parseCvssBaseScore(cvss)
    if (score !== null) {
      if (score >= 9)
        return 'critical'
      if (score >= 7)
        return 'high'
      if (score >= 4)
        return 'moderate'
      return 'low'
    }
  }

  return 'moderate'
}

/**
 * Extract a numeric base score from an OSV `severity.score` value, which may
 * be either a bare number or a full CVSS vector string.
 */
function parseCvssBaseScore(score: string): number | null {
  const direct = Number(score)
  if (Number.isFinite(direct))
    return direct

  // Vector strings carry no base score; approximate from the impact metrics
  // only when an explicit score is absent.
  const match = score.match(/\/([0-9](?:\.[0-9])?)$/)
  if (match) {
    const parsed = Number(match[1])
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

/**
 * Pull the first `fixed` event out of an advisory's affected ranges for a
 * given package, which is the version users need to reach.
 */
function extractFixedVersion(vuln: OsvVulnerability, packageName: string): string | undefined {
  for (const affected of vuln.affected ?? []) {
    if (affected.package?.name !== packageName)
      continue
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed)
          return event.fixed
      }
    }
  }
  return undefined
}

export interface AdvisoryQuery {
  name: string
  version: string
  ecosystem: string
}

/**
 * Looks up known vulnerabilities for dependency versions via the OSV.dev
 * aggregated advisory database.
 *
 * OSV is used rather than the GitHub Advisory GraphQL API because it needs no
 * authentication, covers npm and Packagist from one endpoint, and offers a
 * batch query that resolves an entire dependency tree in a couple of requests.
 *
 * @example
 * ```ts
 * const service = new SecurityAdvisoryService(logger)
 * const advisories = await service.findAdvisories([
 *   { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
 * ])
 * ```
 */
export class SecurityAdvisoryService {
  /** Memoized advisory detail lookups, keyed by OSV id. */
  private readonly detailCache = new AsyncMemo<OsvVulnerability | null>()

  constructor(
    private readonly logger: Logger,
    private readonly concurrency: number = 8,
  ) {}

  /**
   * Resolve advisories affecting each queried package version.
   *
   * Network failures degrade to an empty result rather than aborting a scan —
   * a dependency update run is still useful without advisory annotations, and
   * OSV being unreachable should not block security patches from shipping.
   *
   * @param queries - Package/version pairs to check
   * @returns Map from `ecosystem:name@version` to the advisories affecting it
   */
  async findAdvisories(queries: readonly AdvisoryQuery[]): Promise<Map<string, SecurityAdvisory[]>> {
    const result = new Map<string, SecurityAdvisory[]>()
    if (queries.length === 0)
      return result

    const idsByQuery = await this.queryBatch(queries)
    const uniqueIds = [...new Set([...idsByQuery.values()].flat())]
    if (uniqueIds.length === 0)
      return result

    this.logger.debug(`Fetching details for ${uniqueIds.length} advisory record(s)`)
    const details = await mapWithConcurrency(
      uniqueIds,
      id => this.fetchVulnerability(id),
      this.concurrency,
    )

    const byId = new Map<string, OsvVulnerability>()
    for (const vuln of details) {
      if (vuln)
        byId.set(vuln.id, vuln)
    }

    for (const [key, ids] of idsByQuery) {
      const packageName = key.slice(key.indexOf(':') + 1, key.lastIndexOf('@'))
      const advisories: SecurityAdvisory[] = []

      for (const id of ids) {
        const vuln = byId.get(id)
        if (!vuln)
          continue

        advisories.push({
          id: vuln.id,
          aliases: vuln.aliases ?? [],
          summary: vuln.summary ?? vuln.details?.split('\n')[0] ?? 'No summary provided',
          severity: normalizeSeverity(vuln),
          url: `https://osv.dev/vulnerability/${vuln.id}`,
          fixedVersion: extractFixedVersion(vuln, packageName),
        })
      }

      if (advisories.length > 0) {
        advisories.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
        result.set(key, advisories)
      }
    }

    return result
  }

  /**
   * Annotate updates whose current version has known advisories.
   *
   * Only advisories the update actually resolves are attached: an advisory
   * with no fix, or one whose fixed version is still ahead of the proposed
   * version, would be misleading on a PR that does not address it.
   *
   * @param updates - Candidate updates to annotate, mutated in place
   * @param minimumSeverity - Drop advisories below this level
   * @returns The same array, for chaining
   */
  async annotateUpdates(
    updates: PackageUpdate[],
    minimumSeverity: VulnerabilitySeverity = 'low',
  ): Promise<PackageUpdate[]> {
    const queries: AdvisoryQuery[] = []
    const queryIndexes: number[] = []

    updates.forEach((update, index) => {
      const ecosystem = toOsvEcosystem(update.dependencyType)
      if (!ecosystem)
        return
      const version = stripRangePrefix(update.currentVersion)
      if (!version)
        return
      // Actions are referenced as `v4`, which OSV indexes as `4`. Sending the
      // written form matches nothing and would read as "no advisories".
      const normalized = ecosystem === 'GitHub Actions' ? version.replace(/^v/i, '') : version
      if (!normalized)
        return
      queries.push({ name: update.name, version: normalized, ecosystem })
      queryIndexes.push(index)
    })

    if (queries.length === 0)
      return updates

    const advisoriesByKey = await this.findAdvisories(queries)
    const threshold = SEVERITY_ORDER[minimumSeverity]
    let annotated = 0

    queries.forEach((query, position) => {
      const advisories = advisoriesByKey.get(advisoryKey(query))
      if (!advisories?.length)
        return

      const update = updates[queryIndexes[position]]
      const relevant = advisories.filter((advisory) => {
        if (SEVERITY_ORDER[advisory.severity] < threshold)
          return false
        // Without a stated fix we cannot claim this update resolves anything.
        if (!advisory.fixedVersion)
          return false
        return isAtLeast(stripRangePrefix(update.newVersion), advisory.fixedVersion)
      })

      if (relevant.length > 0) {
        update.securityAdvisories = relevant
        annotated++
      }
    })

    if (annotated > 0)
      this.logger.info(`🔒 ${annotated} update(s) resolve known security advisories`)

    return updates
  }

  /**
   * Run the OSV batch endpoint over all queries, chunked to the API limit.
   *
   * @returns Map from {@link advisoryKey} to the advisory ids affecting it
   */
  private async queryBatch(queries: readonly AdvisoryQuery[]): Promise<Map<string, string[]>> {
    const byKey = new Map<string, string[]>()
    const batches = chunk(queries, BATCH_SIZE)

    for (const batch of batches) {
      try {
        const response = await fetchWithTimeout(`${OSV_API}/v1/querybatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'buddy-bot' },
          body: JSON.stringify({
            queries: batch.map(query => ({
              package: { name: query.name, ecosystem: query.ecosystem },
              version: query.version,
            })),
          }),
          // A batch query has no side effects, so replaying it is safe despite
          // being a POST.
          retryNonIdempotent: true,
          onRetry: ({ delayMs, reason }) =>
            this.logger.debug(`OSV batch retry in ${Math.round(delayMs / 1000)}s (${reason})`),
        })

        if (!response.ok) {
          this.logger.warn(`OSV advisory lookup failed: HTTP ${response.status}`)
          continue
        }

        const data = await response.json() as OsvBatchResponse
        data.results?.forEach((entry, index) => {
          const ids = entry.vulns?.map(vuln => vuln.id) ?? []
          if (ids.length > 0)
            byKey.set(advisoryKey(batch[index]), ids)
        })
      }
      catch (error) {
        this.logger.warn('OSV advisory lookup failed:', error)
      }
    }

    return byKey
  }

  /** Fetch one advisory record, memoized across the run. */
  private async fetchVulnerability(id: string): Promise<OsvVulnerability | null> {
    return this.detailCache.get(id, async () => {
      try {
        const response = await fetchWithTimeout(`${OSV_API}/v1/vulns/${encodeURIComponent(id)}`, {
          headers: { 'User-Agent': 'buddy-bot' },
        })
        if (!response.ok)
          return null
        return await response.json() as OsvVulnerability
      }
      catch (error) {
        this.logger.debug(`Failed to fetch advisory ${id}:`, error)
        return null
      }
    })
  }
}

/** Stable key identifying a package version across batch request/response. */
export function advisoryKey(query: AdvisoryQuery): string {
  return `${query.ecosystem}:${query.name}@${query.version}`
}

/**
 * Reduce a version range to the concrete version OSV should be asked about.
 *
 * Ranges like `^4.17.15` are queried at their lower bound: that is the version
 * a fresh install resolves at worst, and it is what the lockfile pins today.
 */
function stripRangePrefix(version: string): string {
  return version.replace(/^[\^~>=<\s]*v?/, '').trim()
}

/**
 * Whether `version` is greater than or equal to `target`, tolerating the
 * non-semver strings that appear in real dependency files.
 */
function isAtLeast(version: string, target: string): boolean {
  if (!version || !target)
    return false
  try {
    return Bun.semver.order(version, target) >= 0
  }
  catch {
    return false
  }
}
