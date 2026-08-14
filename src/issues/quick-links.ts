import type { PackageContext } from './enrichment'
import { findMentionedPackages, renderPackageContext } from './enrichment'

/** Marker identifying the quick-links comment, so it updates rather than repeats. */
export const QUICK_LINKS_MARKER = '<!-- buddy-bot:quick-links -->'

/** An action a maintainer can request by ticking a box. */
export interface QuickAction {
  /** Slug written into the checkbox marker */
  id: string
  label: string
  description: string
}

/** The actions offered on a new issue. */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'plan',
    label: 'Make a plan',
    description: 'Read the issue and the relevant code, then post an implementation plan. Changes nothing.',
  },
  {
    id: 'build',
    label: 'Build this',
    description: 'Open a draft pull request implementing the issue.',
  },
]

/** Which quick actions a comment body requests. */
export interface QuickSelection {
  actions: string[]
}

const CHECKED_ACTION = /- \[x\]\s*<!--\s*quick-action=([\w-]+)\s*-->/gi

/**
 * Parse which quick actions were ticked.
 *
 * The marker carries the action id rather than the label, so retitling a
 * button in a later release cannot silently change which action an
 * already-posted comment triggers.
 *
 * @param body - Comment body
 * @returns The requested action ids
 */
export function parseQuickSelection(body: string | null | undefined): QuickSelection {
  if (!body)
    return { actions: [] }

  const actions: string[] = []
  for (const match of body.matchAll(CHECKED_ACTION)) {
    const id = match[1].trim()
    // Only actions this version knows how to run: an unknown id from a newer
    // or hand-edited comment must not reach a dispatcher.
    if (QUICK_ACTIONS.some(action => action.id === id) && !actions.includes(id))
      actions.push(id)
  }

  return { actions }
}

/**
 * Clear the ticked boxes in a quick-links comment.
 *
 * Called after the actions run, so the comment does not re-trigger on the next
 * poll — the same reason the dashboard unchecks its own boxes.
 *
 * @param body - Comment body
 * @returns The body with every quick-action box cleared
 */
export function clearQuickSelection(body: string): string {
  return body.replace(/- \[x\](\s*<!--\s*quick-action=[\w-]+\s*-->)/gi, '- [ ]$1')
}

/**
 * Render the quick-links comment for a new issue.
 *
 * Both actions are opt-in checkboxes rather than automatic. An issue is a
 * request for a conversation as often as for code, and a bot that opens a pull
 * request against every new issue is one a maintainer turns off in a week.
 *
 * @param options - Issue text and known packages, for the context section
 * @returns The comment body
 * @example
 * ```ts
 * await provider.createComment(issue.number, renderQuickLinks({ body: issue.body, packages }))
 * ```
 */
export function renderQuickLinks(options: {
  body?: string
  /** Dependency metadata, for the context section */
  packages?: PackageContext[]
} = {}): string {
  const lines: string[] = [
    QUICK_LINKS_MARKER,
    '',
    '### Buddy Bot',
    '',
    'Tick a box to have Buddy Bot pick this up:',
    '',
  ]

  for (const action of QUICK_ACTIONS) {
    lines.push(`- [ ] <!-- quick-action=${action.id} -->**${action.label}** — ${action.description}`)
  }

  // Dependency context is added only when the issue actually names a package
  // this repository depends on; a section that says nothing is noise on every
  // issue that is not about dependencies.
  const mentioned = options.packages?.length && options.body
    ? findMentionedPackages(options.body, options.packages.map(entry => entry.name))
    : []

  if (mentioned.length > 0) {
    const context = options.packages!.filter(entry => mentioned.includes(entry.name))
    lines.push('', renderPackageContext(context))
  }

  return lines.join('\n')
}
