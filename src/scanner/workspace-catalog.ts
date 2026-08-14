/** A dependency declared in a pnpm workspace catalog. */
export interface CatalogEntry {
  name: string
  version: string
  /** Catalog it belongs to; `default` for the unnamed one */
  catalog: string
}

/** Everything a `pnpm-workspace.yaml` declares. */
export interface WorkspaceCatalogs {
  entries: CatalogEntry[]
  /** Whether the file declared any catalog at all */
  hasCatalogs: boolean
}

/** The `catalog:` protocol, optionally naming a specific catalog. */
const CATALOG_PROTOCOL = /^catalog:(.*)$/

/**
 * Parse the catalogs from a `pnpm-workspace.yaml`.
 *
 * pnpm's catalogs move the version out of every `package.json` and into one
 * place, so a workspace using them has package files whose versions are all
 * `catalog:` — updating those would write the protocol string over itself and
 * change nothing. The catalog is where the version actually lives.
 *
 * @param content - File content
 * @returns Catalog entries, and whether any catalog was declared
 * @example
 * ```ts
 * const { entries } = parseWorkspaceCatalogs(await Bun.file('pnpm-workspace.yaml').text())
 * ```
 */
export function parseWorkspaceCatalogs(content: string): WorkspaceCatalogs {
  let parsed: unknown

  try {
    parsed = Bun.YAML.parse(content)
  }
  catch {
    return { entries: [], hasCatalogs: false }
  }

  if (typeof parsed !== 'object' || parsed === null)
    return { entries: [], hasCatalogs: false }

  const workspace = parsed as { catalog?: unknown, catalogs?: unknown }
  const entries: CatalogEntry[] = []
  let hasCatalogs = false

  const collect = (table: unknown, catalog: string): void => {
    if (typeof table !== 'object' || table === null || Array.isArray(table))
      return

    hasCatalogs = true

    for (const [name, version] of Object.entries(table as Record<string, unknown>)) {
      if (typeof version === 'string' && version.trim())
        entries.push({ name, version: version.trim(), catalog })
    }
  }

  collect(workspace.catalog, 'default')

  if (typeof workspace.catalogs === 'object' && workspace.catalogs !== null) {
    for (const [name, table] of Object.entries(workspace.catalogs as Record<string, unknown>))
      collect(table, name)
  }

  return { entries, hasCatalogs }
}

/**
 * Resolve a `catalog:` reference to the version it names.
 *
 * @param reference - A version string from a package.json
 * @param catalogs - Entries parsed from the workspace file
 * @param packageName - The package the reference belongs to
 * @returns The catalog's version, or null when the reference is not a catalog
 * reference or names a catalog with no entry for this package
 */
export function resolveCatalogReference(
  reference: string,
  catalogs: CatalogEntry[],
  packageName: string,
): string | null {
  const match = CATALOG_PROTOCOL.exec(reference.trim())
  if (!match)
    return null

  // `catalog:` and `catalog:default` both name the unnamed catalog.
  const wanted = match[1].trim() || 'default'

  return catalogs.find(entry => entry.name === packageName && entry.catalog === wanted)?.version ?? null
}

/** Whether a version string is a `catalog:` reference. */
export function isCatalogReference(version: string): boolean {
  return CATALOG_PROTOCOL.test(version.trim())
}

/**
 * Write an updated version into a `pnpm-workspace.yaml`.
 *
 * Line-based rather than a YAML round-trip, because re-serializing loses the
 * comments and key order a maintainer arranged. Matching is scoped to the
 * catalog block the entry belongs to, so two catalogs naming the same package
 * at different versions each keep their own.
 *
 * @param content - Current file content
 * @param entry - The entry to update
 * @param newVersion - Version to write
 * @returns The updated content, unchanged when the entry was not found
 */
export function applyCatalogUpdate(content: string, entry: CatalogEntry, newVersion: string): string {
  const lines = content.split('\n')
  const quoted = /^(\s*)(["']?)([^"':]+)\2(\s*:\s*)(["']?)(.+?)\5(\s*(?:#.*)?)$/

  /** Which catalog block a line sits in, tracked by indentation. */
  let currentCatalog: string | null = null
  let inCatalogsTable = false
  let catalogsIndent = 0

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()

    if (/^catalog\s*:\s*$/.test(trimmed)) {
      currentCatalog = 'default'
      inCatalogsTable = false
      continue
    }

    if (/^catalogs\s*:\s*$/.test(trimmed)) {
      inCatalogsTable = true
      catalogsIndent = indent
      currentCatalog = null
      continue
    }

    // A named catalog heading is a key with no value, nested under `catalogs:`.
    if (inCatalogsTable && indent > catalogsIndent && /^[\w@./-]+\s*:\s*$/.test(trimmed)) {
      currentCatalog = trimmed.replace(/\s*:\s*$/, '')
      continue
    }

    // Dedenting out of `catalogs:` ends the table.
    if (inCatalogsTable && trimmed && indent <= catalogsIndent) {
      inCatalogsTable = false
      currentCatalog = null
    }

    if (currentCatalog !== entry.catalog)
      continue

    const match = quoted.exec(line)
    if (!match || match[3].trim() !== entry.name || match[6].trim() !== entry.version)
      continue

    const [, leading, nameQuote, name, separator, valueQuote, , trailing] = match
    lines[index] = `${leading}${nameQuote}${name}${nameQuote}${separator}${valueQuote}${newVersion}${valueQuote}${trailing}`
    return lines.join('\n')
  }

  return content
}
