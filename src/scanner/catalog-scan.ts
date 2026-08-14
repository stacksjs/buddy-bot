import type { PackageUpdate } from '../types'
import type { Logger } from '../utils/logger'
import type { CatalogEntry } from './workspace-catalog'
import { join } from 'node:path'
import { getDefaultLogger } from '../utils/logger'
import { applyCatalogUpdate, parseWorkspaceCatalogs } from './workspace-catalog'

/** Where pnpm workspace catalogs live. */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml'

/** Alternative spelling pnpm also accepts. */
export const WORKSPACE_FILE_ALT = 'pnpm-workspace.yml'

/** What a catalog scan found. */
export interface CatalogScanResult {
  updates: PackageUpdate[]
  entries: CatalogEntry[]
  /** The workspace file that was read, absent when there is none */
  file?: string
}

/**
 * Scan a workspace's catalogs for updates.
 *
 * Catalogs are where the version lives in a workspace that uses them — every
 * `package.json` says `catalog:`, so updating those files would write the
 * protocol string over itself and change nothing at all. This is the only
 * place an update can land.
 *
 * @param dir - Repository root
 * @param resolveLatest - Looks a package's newest version up
 * @param options - Ignore list and logger
 * @returns Updates against the workspace file
 * @example
 * ```ts
 * const { updates } = await scanCatalogs(root, name => registry.getLatest(name))
 * ```
 */
export async function scanCatalogs(
  dir: string,
  resolveLatest: (name: string) => Promise<string | null>,
  options: { ignore?: string[], logger?: Logger } = {},
): Promise<CatalogScanResult> {
  const logger = options.logger ?? getDefaultLogger()
  const ignore = new Set(options.ignore ?? [])

  for (const candidate of [WORKSPACE_FILE, WORKSPACE_FILE_ALT]) {
    const file = Bun.file(join(dir, candidate))
    if (!(await file.exists()))
      continue

    const { entries, hasCatalogs } = parseWorkspaceCatalogs(await file.text())
    if (!hasCatalogs)
      return { updates: [], entries: [], file: candidate }

    logger.debug(`📦 ${candidate}: ${entries.length} catalog entr(ies)`)

    const resolved = await Promise.all(entries.map(async (entry) => {
      if (ignore.has(entry.name))
        return null

      try {
        const latest = await resolveLatest(entry.name)
        if (!latest)
          return null

        // The declared version carries an operator; comparing the operator
        // against a bare version would report every entry as outdated.
        const declared = entry.version.replace(/^[\^~>=<\s]+/, '').trim()
        if (!declared || declared === latest)
          return null

        return {
          name: entry.name,
          currentVersion: entry.version,
          newVersion: preserveOperator(entry.version, latest),
          updateType: classify(declared, latest),
          dependencyType: 'catalog' as const,
          file: candidate,
          resolved: { catalog: entry.catalog },
        } as PackageUpdate
      }
      catch (error) {
        logger.debug(`Could not resolve catalog entry ${entry.name}: ${error}`)
        return null
      }
    }))

    return {
      updates: resolved.filter((update): update is PackageUpdate => update !== null),
      entries,
      file: candidate,
    }
  }

  return { updates: [], entries: [] }
}

/** Carry the declared operator onto a new version. */
function preserveOperator(declared: string, version: string): string {
  const operator = /^([\^~]|>=|<=|>|<)?/.exec(declared.trim())?.[1] ?? ''
  return `${operator}${version}`
}

/** Classify a change between two dotted versions. */
function classify(from: string, to: string): 'major' | 'minor' | 'patch' {
  const parse = (value: string): number[] => value.split('.').map(part => Number.parseInt(part, 10) || 0)
  const a = parse(from)
  const b = parse(to)

  if ((a[0] ?? 0) !== (b[0] ?? 0))
    return 'major'
  if ((a[1] ?? 0) !== (b[1] ?? 0))
    return 'minor'
  return 'patch'
}

/**
 * Write catalog updates into the workspace file.
 *
 * @param content - Current file content
 * @param updates - Catalog updates to apply
 * @returns The updated content
 */
export function applyCatalogUpdates(content: string, updates: PackageUpdate[]): string {
  let result = content

  for (const update of updates) {
    if (update.dependencyType !== 'catalog')
      continue

    result = applyCatalogUpdate(
      result,
      {
        name: update.name,
        version: update.currentVersion,
        catalog: update.resolved?.catalog ?? 'default',
      },
      update.newVersion,
    )
  }

  return result
}
