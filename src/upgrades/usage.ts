import { resolve } from 'node:path'

/** Where a package is used in the repository. */
export interface UsageSite {
  path: string
  line: number
  /** The line itself, for the model to read in context */
  text: string
  /** How the package is referenced */
  kind: 'import' | 'require' | 'config' | 'mention'
}

/** Files worth scanning for usage of a JavaScript package. */
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|vue|svelte)$/

/** Files where a package name appears as configuration rather than code. */
const CONFIG_FILES = /(?:^|\/)(?:[\w.-]*\.config\.[cm]?[jt]s|\.?[\w-]*rc(?:\.\w+)?|tsconfig\.json|vite\.config\.[cm]?[jt]s)$/

/**
 * Find where a package is used.
 *
 * Matching is done on import and require specifiers rather than free text, so
 * a changelog mentioning a package name in prose does not become a usage site
 * the migration then tries to edit.
 *
 * @param packageName - Package to look for
 * @param files - Repository-relative paths to scan
 * @param root - Repository root
 * @returns Every place the package is referenced
 * @example
 * ```ts
 * const sites = await findUsageSites('react', await listSourceFiles(), process.cwd())
 * ```
 */
export async function findUsageSites(
  packageName: string,
  files: string[],
  root: string,
): Promise<UsageSite[]> {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // A specifier is the package itself or a subpath of it — `react` matches
  // `react` and `react/jsx-runtime`, but not `react-dom`.
  const specifier = `${escaped}(?:/[^'"\`]*)?`
  const importPattern = new RegExp(`(?:^|\\s)import\\s[^'"\`]*['"\`]${specifier}['"\`]|from\\s*['"\`]${specifier}['"\`]`)
  const requirePattern = new RegExp(`require\\s*\\(\\s*['"\`]${specifier}['"\`]\\s*\\)`)
  const dynamicPattern = new RegExp(`import\\s*\\(\\s*['"\`]${specifier}['"\`]\\s*\\)`)
  const bareName = new RegExp(`(?:^|[^\\w@/.-])${escaped}(?![\\w/.-])`)

  const sites: UsageSite[] = []

  for (const path of files) {
    const isSource = SOURCE_EXTENSIONS.test(path)
    const isConfig = CONFIG_FILES.test(path)
    if (!isSource && !isConfig)
      continue

    let content: string
    try {
      const file = Bun.file(resolve(root, path))
      if (!(await file.exists()))
        continue
      content = await file.text()
    }
    catch {
      continue
    }

    // Cheap rejection before the per-line work; most files mention nothing.
    if (!content.includes(packageName))
      continue

    for (const [index, line] of content.split('\n').entries()) {
      let kind: UsageSite['kind'] | null = null

      if (importPattern.test(line) || dynamicPattern.test(line))
        kind = 'import'
      else if (requirePattern.test(line))
        kind = 'require'
      else if (isConfig && bareName.test(line))
        kind = 'config'

      if (kind)
        sites.push({ path, line: index + 1, text: line.trim().slice(0, 200), kind })
    }
  }

  return sites
}

/**
 * Group usage sites by file, for presenting an impact summary.
 *
 * @param sites - Usage sites
 */
export function summarizeUsage(sites: UsageSite[]): Array<{ path: string, count: number }> {
  const counts = new Map<string, number>()

  for (const site of sites)
    counts.set(site.path, (counts.get(site.path) ?? 0) + 1)

  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
}
