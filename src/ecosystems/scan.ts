import type { PackageUpdate } from '../types'
import type { Logger } from '../utils/logger'
import type { EcosystemAdapter } from './types'
import { join } from 'node:path'
import { getDefaultLogger } from '../utils/logger'
import { BUILTIN_ADAPTERS } from './index'

/** What an adapter-driven scan found. */
export interface AdapterScanResult {
  updates: PackageUpdate[]
  /** Every dependency seen, per ecosystem, for reporting */
  dependenciesByEcosystem: Record<string, number>
  /** Adapters that found manifests, with how many */
  manifests: Array<{ ecosystem: string, files: string[] }>
}

/** Options for an adapter-driven scan. */
export interface AdapterScanOptions {
  /** Repository root */
  dir: string
  adapters?: EcosystemAdapter[]
  includePrerelease?: boolean
  /** Package names to skip */
  ignore?: string[]
  logger?: Logger
}

/**
 * Scan every registered ecosystem for updates.
 *
 * Adapters run concurrently and independently: a registry outage in one
 * ecosystem must not lose the updates another already found, which is why each
 * failure is logged and skipped rather than raised.
 *
 * @param options - Root directory and adapter configuration
 * @returns Updates, plus the dependency inventory the report needs
 * @example
 * ```ts
 * const { updates } = await scanEcosystems({ dir: process.cwd() })
 * ```
 */
export async function scanEcosystems(options: AdapterScanOptions): Promise<AdapterScanResult> {
  const logger = options.logger ?? getDefaultLogger()
  const adapters = options.adapters ?? BUILTIN_ADAPTERS
  const ignore = new Set(options.ignore ?? [])

  const updates: PackageUpdate[] = []
  const dependenciesByEcosystem: Record<string, number> = {}
  const manifests: AdapterScanResult['manifests'] = []

  await Promise.all(adapters.map(async (adapter) => {
    let files: string[]

    try {
      files = await adapter.detect(options.dir)
    }
    catch (error) {
      logger.warn(`⚠️ ${adapter.name}: could not look for manifests: ${error}`)
      return
    }

    if (files.length === 0)
      return

    manifests.push({ ecosystem: adapter.name, files })
    logger.debug(`📦 ${adapter.name}: ${files.length} manifest(s)`)

    for (const file of files) {
      let dependencies

      try {
        dependencies = await adapter.parse(file, await Bun.file(join(options.dir, file)).text())
      }
      catch (error) {
        logger.warn(`⚠️ ${adapter.name}: could not parse ${file}: ${error}`)
        continue
      }

      dependenciesByEcosystem[adapter.name] = (dependenciesByEcosystem[adapter.name] ?? 0) + dependencies.length

      const resolved = await Promise.all(dependencies.map(async (dependency) => {
        if (ignore.has(dependency.name))
          return null

        try {
          const info = await adapter.latest(dependency, {
            ...(options.includePrerelease !== undefined ? { includePrerelease: options.includePrerelease } : {}),
            logger,
          })

          if (!info)
            return null

          // Compared with the ecosystem's own ordering rather than a shared
          // one, which is the point of the adapter interface: PEP 440 and
          // semver disagree about which of two versions is newer.
          const declared = stripOperators(dependency.currentVersion)
          if (adapter.compareVersions(info.latest, declared) <= 0)
            return null

          return {
            name: dependency.name,
            currentVersion: dependency.currentVersion,
            newVersion: info.latest,
            updateType: adapter.updateType(declared, info.latest),
            dependencyType: adapter.name as PackageUpdate['dependencyType'],
            file,
            ...(info.releaseNotesUrl ? { releaseNotesUrl: info.releaseNotesUrl } : {}),
            ...(info.homepage ? { homepage: info.homepage } : {}),
          } as PackageUpdate
        }
        catch (error) {
          logger.debug(`${adapter.name}: could not resolve ${dependency.name}: ${error}`)
          return null
        }
      }))

      updates.push(...resolved.filter((update): update is PackageUpdate => update !== null))
    }
  }))

  return { updates, dependenciesByEcosystem, manifests }
}

/**
 * Strip constraint operators to get a comparable version.
 *
 * A constraint is not a version and cannot be compared against one. Taking the
 * first version in the constraint is the conventional reading of "what this
 * repository is on" — the floor of the allowed range.
 */
export function stripOperators(constraint: string): string {
  const match = /(\d[\w.!+-]*)/.exec(constraint)
  return match ? match[1] : constraint.trim()
}

/**
 * Run every adapter's lockfile regeneration.
 *
 * @param dir - Repository root
 * @param ecosystems - Ecosystem names whose manifests changed
 * @param adapters - Adapters to consider
 * @returns Regenerated lockfiles and notes about any that could not be
 */
export async function regenerateLockfiles(
  dir: string,
  ecosystems: string[],
  adapters: EcosystemAdapter[] = BUILTIN_ADAPTERS,
): Promise<{ regenerated: string[], notes: string[] }> {
  const regenerated: string[] = []
  const notes: string[] = []

  for (const adapter of adapters) {
    if (!ecosystems.includes(adapter.name) || !adapter.postWrite)
      continue

    const result = await adapter.postWrite(dir).catch(() => ({ regenerated: [], note: undefined }))
    regenerated.push(...result.regenerated)
    if (result.note)
      notes.push(result.note)
  }

  return { regenerated, notes }
}
