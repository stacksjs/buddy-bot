import type { EcosystemAdapter } from './types'
import { goAdapter } from './go'
import { pythonAdapter } from './python'
import { rubyAdapter } from './ruby'
import { rustAdapter } from './rust'

/**
 * Adapters registered by default.
 *
 * These are the ecosystems that reach the scanner through the adapter
 * interface. The older ecosystems (npm, Composer, Actions, Docker, pkgx) still
 * run through their own paths and migrate incrementally — rewriting all of
 * them at once would mean re-testing every existing behaviour to add four new
 * ones.
 */
export const BUILTIN_ADAPTERS: EcosystemAdapter[] = [
  pythonAdapter,
  rustAdapter,
  goAdapter,
  rubyAdapter,
]

/**
 * Find the adapter for a manifest path.
 *
 * @param file - Repository-relative path
 * @param adapters - Adapters to consider
 * @returns The adapter that claims the file, or null
 */
export function adapterFor(
  file: string,
  adapters: EcosystemAdapter[] = BUILTIN_ADAPTERS,
): EcosystemAdapter | null {
  const base = file.split('/').pop() ?? file

  for (const adapter of adapters) {
    if (adapter.manifestPatterns.some(pattern => matchesPattern(base, pattern) || matchesPattern(file, pattern)))
      return adapter
  }

  return null
}

/** Match a path against a `*`-only glob, anchored at both ends. */
function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern.includes('*'))
    return value === pattern

  const source = pattern
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')

  return new RegExp(`^${source}$`).test(value)
}

/**
 * Look an adapter up by name.
 *
 * @param name - Ecosystem name
 * @param adapters - Adapters to consider
 */
export function adapterNamed(
  name: string,
  adapters: EcosystemAdapter[] = BUILTIN_ADAPTERS,
): EcosystemAdapter | null {
  return adapters.find(adapter => adapter.name === name) ?? null
}

export { goAdapter } from './go'
export {
  comparePep440,
  isPep440Prerelease,
  parsePep440,
  pep440UpdateType,
  splitConstraint,
} from './pep440'
export type { Pep440Version } from './pep440'
export { pythonAdapter } from './python'
export { rubyAdapter } from './ruby'
export { rustAdapter } from './rust'
export { regenerateLockfiles, scanEcosystems, stripOperators } from './scan'
export type { AdapterScanOptions, AdapterScanResult } from './scan'
export {
  commandAvailable,
  compareNumeric,
  detectFiles,
  escapeRegex,
  numericUpdateType,
  regenerateWith,
} from './shared'
export type { LockfileCommand } from './shared'
export type {
  EcosystemAdapter,
  EcosystemDependency,
  EcosystemUpdate,
  LatestOptions,
  VersionInfo,
} from './types'
