import type { UpdateGroup } from '../types'

/**
 * Values a user-supplied PR template can interpolate.
 *
 * Tokens are written as `{name}` and unknown tokens are left untouched, so a
 * literal brace in a template survives rather than becoming an empty string.
 */
export interface TemplateTokens {
  /** The generated default (title or commit message) */
  title?: string
  message?: string
  /** Update group name, e.g. `Non-Major Updates` */
  group?: string
  /** Number of packages in the pull request */
  count?: number
  /** Configured update strategy */
  strategy?: string
  /** Highest semver impact in the group */
  updateType?: string
  /** Comma-separated package names */
  packages?: string
  /** Rendered dependency tables and release notes */
  updatesTable?: string
  releaseNotes?: string
  /** Body sections, for `bodyTemplate` */
  footer?: string
  packageCount?: number
}

const TOKEN_PATTERN = /\{([a-z_]+)\}/gi

/** Maps a `{token}` name to the key it reads from {@link TemplateTokens}. */
const TOKEN_ALIASES: Record<string, keyof TemplateTokens> = {
  title: 'title',
  message: 'message',
  group: 'group',
  count: 'count',
  strategy: 'strategy',
  update_type: 'updateType',
  updateType: 'updateType',
  packages: 'packages',
  updates_table: 'updatesTable',
  release_notes: 'releaseNotes',
  footer: 'footer',
  package_count: 'packageCount',
}

/**
 * Substitutes `{token}` placeholders in a user-supplied template.
 *
 * Unknown tokens are preserved verbatim: silently blanking them would turn a
 * typo into missing PR content with no indication of why.
 *
 * @param template - Template string from config
 * @param tokens - Values available for substitution
 * @returns The rendered string
 * @example
 * ```ts
 * applyTemplate('chore(deps): {title}', { title: 'update react to v18' })
 * // => 'chore(deps): update react to v18'
 * ```
 */
export function applyTemplate(template: string, tokens: TemplateTokens): string {
  return template.replace(TOKEN_PATTERN, (match, name: string) => {
    const key = TOKEN_ALIASES[name] ?? TOKEN_ALIASES[name.toLowerCase()]
    if (!key)
      return match

    const value = tokens[key]
    return value === undefined ? match : String(value)
  })
}

/**
 * Builds the token set describing an update group.
 *
 * @param group - Group backing the pull request
 * @param defaults - Generated title and commit message to expose as tokens
 * @param strategy - Configured update strategy
 */
export function templateTokensForGroup(
  group: UpdateGroup,
  defaults: { title?: string, message?: string } = {},
  strategy?: string,
): TemplateTokens {
  return {
    ...defaults,
    group: group.name,
    count: group.updates.length,
    packageCount: group.updates.length,
    updateType: group.updateType,
    packages: group.updates.map(update => update.name).join(', '),
    ...(strategy ? { strategy } : {}),
  }
}
