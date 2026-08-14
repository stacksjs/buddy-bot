import type { RegistryClient } from '../registry/registry-client'
import type { PackageFile } from '../types'
import type { Logger } from '../utils/logger'
import type { DeclaredRange, DriftInput } from './resolution-drift'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ROOT } from './resolution-drift'

/** Dependency blocks that constrain what version may be installed. */
const CONSTRAINING_BLOCKS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

interface InstalledPackage {
  name: string
  version: string
  ranges: Record<string, string>
}

/**
 * Gather the inputs resolution-drift analysis needs.
 *
 * Ranges come from two places: the manifests in the repository, and the
 * manifests of everything installed under `node_modules`. The second is what
 * makes the analysis worth running — a package held back by a dependant's
 * range is invisible from the repository's own manifests.
 *
 * @param packageFiles - Scanned manifests from the project
 * @param registry - Client used to list published versions
 * @param projectPath - Directory containing `node_modules`
 * @param logger - Logger for diagnostics
 * @returns One input per installed package that also has published versions
 */
export async function collectDriftInputs(
  packageFiles: PackageFile[],
  registry: RegistryClient,
  projectPath: string,
  logger: Logger,
): Promise<DriftInput[]> {
  const installed = await readInstalledPackages(projectPath, logger)
  if (installed.length === 0)
    return []

  // Every range declared anywhere: the repository's own manifests first, then
  // each installed package's declarations about its dependencies.
  const declaredByPackage = new Map<string, DeclaredRange[]>()

  const declare = (name: string, by: string, range: string): void => {
    const existing = declaredByPackage.get(name)
    const entry = { by, range }
    if (existing)
      existing.push(entry)
    else
      declaredByPackage.set(name, [entry])
  }

  for (const file of packageFiles) {
    for (const dependency of file.dependencies)
      declare(dependency.name, ROOT, dependency.currentVersion)
  }

  for (const pkg of installed) {
    for (const [name, range] of Object.entries(pkg.ranges))
      declare(name, pkg.name, range)
  }

  const inputs: DriftInput[] = []

  for (const pkg of installed) {
    const declared = declaredByPackage.get(pkg.name)
    if (!declared || declared.length === 0)
      continue

    try {
      const metadata = await registry.getPackageMetadata(pkg.name)
      if (!metadata?.versions?.length)
        continue

      inputs.push({
        name: pkg.name,
        installed: pkg.version,
        available: metadata.versions,
        declared,
      })
    }
    catch (error) {
      logger.debug(`Skipping drift analysis for ${pkg.name}: ${error}`)
    }
  }

  return inputs
}

/**
 * Read every package installed at the top level of `node_modules`.
 *
 * Only the top level is walked: nested installs exist precisely because a
 * range conflicted, which is a different problem from a package being held
 * back, and walking them would multiply the work for little added signal.
 */
async function readInstalledPackages(projectPath: string, logger: Logger): Promise<InstalledPackage[]> {
  const modulesPath = join(projectPath, 'node_modules')
  const packages: InstalledPackage[] = []

  let entries: string[]
  try {
    entries = await readdir(modulesPath)
  }
  catch {
    logger.debug('No node_modules directory, skipping resolution drift analysis')
    return []
  }

  const directories: string[] = []
  for (const entry of entries) {
    if (entry.startsWith('.'))
      continue

    if (entry.startsWith('@')) {
      // Scoped packages nest one level deeper.
      try {
        const scoped = await readdir(join(modulesPath, entry))
        directories.push(...scoped.map(name => `${entry}/${name}`))
      }
      catch {
        continue
      }
      continue
    }

    directories.push(entry)
  }

  await Promise.all(directories.map(async (directory) => {
    try {
      const manifest = await Bun.file(join(modulesPath, directory, 'package.json')).json() as {
        name?: string
        version?: string
      } & Partial<Record<typeof CONSTRAINING_BLOCKS[number], Record<string, string>>>

      if (!manifest.name || !manifest.version)
        return

      const ranges: Record<string, string> = {}
      for (const block of CONSTRAINING_BLOCKS)
        Object.assign(ranges, manifest[block] ?? {})

      packages.push({ name: manifest.name, version: manifest.version, ranges })
    }
    catch {
      // A directory without a readable manifest is not an installed package.
    }
  }))

  return packages
}
