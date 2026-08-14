import type { PackageUpdate, PRManifest, PRManifestUpdate, UpdateGroup } from '../types'

/**
 * Marker that opens the manifest comment. Kept stable across schema versions —
 * the version lives inside the payload so a parser can decide what to do with
 * a newer manifest instead of failing to find it at all.
 */
const MANIFEST_OPEN = '<!-- buddy-bot:manifest'
const MANIFEST_CLOSE = '-->'

/** Schema version emitted by this build. */
export const MANIFEST_SCHEMA_VERSION = 1

/**
 * Matches a manifest block and captures its JSON payload.
 *
 * Non-greedy so a body containing several comments only yields the manifest.
 */
const MANIFEST_REGEX = /<!--\s*buddy-bot:manifest\s+v(\d+)\s*([\s\S]*?)-->/

function toManifestUpdate(update: PackageUpdate): PRManifestUpdate {
  return {
    name: update.name,
    current: update.currentVersion,
    target: update.newVersion,
    type: update.updateType,
    file: update.file,
    dependencyType: update.dependencyType,
  }
}

/**
 * Serializes package updates into the HTML comment embedded in every PR body.
 *
 * The payload is what `rebase`, auto-close and the dashboard read back, so it
 * has to survive body truncation — callers append it *after* any truncation
 * pass rather than treating it as ordinary body content.
 *
 * @param updates - Updates contained in the pull request
 * @param meta - Group name, strategy and branch recorded for diagnostics
 * @returns The manifest comment, including a leading newline
 * @example
 * ```ts
 * body += serializeManifest(group.updates, { group: group.name })
 * ```
 */
export function serializeManifest(
  updates: PackageUpdate[],
  meta: { group?: string, strategy?: string, branch?: string, generatedAt?: string } = {},
): string {
  const manifest: PRManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    updates: updates.map(toManifestUpdate),
    ...(meta.group ? { group: meta.group } : {}),
    ...(meta.strategy ? { strategy: meta.strategy } : {}),
    ...(meta.branch ? { branch: meta.branch } : {}),
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
  }

  // Compact JSON: the manifest competes with release notes for the 65,536
  // character body budget, and nothing reads it by eye.
  return `\n\n${MANIFEST_OPEN} v${MANIFEST_SCHEMA_VERSION}\n${JSON.stringify(manifest)}\n${MANIFEST_CLOSE}`
}

/**
 * Serializes the manifest for an update group.
 *
 * @param group - Group whose updates back the pull request
 * @param meta - Additional metadata merged into the payload
 */
export function serializeGroupManifest(
  group: UpdateGroup,
  meta: { strategy?: string, branch?: string, generatedAt?: string } = {},
): string {
  return serializeManifest(group.updates, { group: group.name, ...meta })
}

/**
 * Reads the manifest back out of a PR body.
 *
 * Tolerant by design: a missing, malformed or partially-truncated manifest
 * returns `null` so callers can fall back to legacy parsing instead of
 * crashing a workflow run.
 *
 * @param body - Pull request body, possibly `null` for empty PRs
 * @returns The parsed manifest, or `null` when absent or unreadable
 */
export function parseManifest(body: string | null | undefined): PRManifest | null {
  if (!body)
    return null

  const match = body.match(MANIFEST_REGEX)
  if (!match)
    return null

  try {
    const parsed = JSON.parse(match[2].trim()) as unknown
    if (!isManifestShape(parsed))
      return null

    // Unknown future fields are preserved by the spread — only `updates` is
    // normalized, so a v2 manifest stays readable by a v1 consumer.
    return {
      ...parsed,
      schemaVersion: Number(parsed.schemaVersion) || Number(match[1]) || MANIFEST_SCHEMA_VERSION,
      updates: parsed.updates.filter(isManifestUpdate),
    }
  }
  catch {
    // Malformed JSON, usually a manifest clipped by an external body edit.
    return null
  }
}

/**
 * Reports whether a body carries a readable manifest.
 *
 * @param body - Pull request body
 */
export function hasManifest(body: string | null | undefined): boolean {
  return parseManifest(body) !== null
}

/**
 * Removes the manifest comment from a body.
 *
 * Used when regenerating a body so repeated rebases don't stack manifests.
 *
 * @param body - Pull request body
 */
export function stripManifest(body: string): string {
  return body.replace(MANIFEST_REGEX, '').trimEnd()
}

/**
 * Replaces any existing manifest with a freshly serialized one.
 *
 * @param body - Pull request body
 * @param updates - Updates the pull request now contains
 * @param meta - Additional metadata merged into the payload
 */
export function withManifest(
  body: string,
  updates: PackageUpdate[],
  meta: { group?: string, strategy?: string, branch?: string } = {},
): string {
  return stripManifest(body) + serializeManifest(updates, meta)
}

/**
 * Projects manifest entries onto the `{ name, currentVersion, newVersion }`
 * shape the rebase and auto-close paths already work with.
 *
 * @param manifest - Parsed manifest
 */
export function manifestUpdates(
  manifest: PRManifest,
): Array<{ name: string, currentVersion: string, newVersion: string }> {
  return manifest.updates.map(update => ({
    name: update.name,
    currentVersion: update.current,
    newVersion: update.target,
  }))
}

/**
 * Distinct file paths recorded in a manifest, for `ignorePaths` auto-close.
 *
 * @param manifest - Parsed manifest
 */
export function manifestFiles(manifest: PRManifest): string[] {
  return [...new Set(manifest.updates.map(update => update.file).filter(Boolean))]
}

function isManifestShape(value: unknown): value is PRManifest & Record<string, unknown> {
  if (typeof value !== 'object' || value === null)
    return false
  const candidate = value as Record<string, unknown>
  return Array.isArray(candidate.updates)
}

function isManifestUpdate(value: unknown): value is PRManifestUpdate {
  if (typeof value !== 'object' || value === null)
    return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.name === 'string'
    && typeof candidate.current === 'string'
    && typeof candidate.target === 'string'
}
