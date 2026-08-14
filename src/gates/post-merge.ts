import type { GitProvider } from '../git/provider'
import type { PullRequest } from '../types'
import type { Logger } from '../utils/logger'
import { getDefaultLogger } from '../utils/logger'
import { findLinkedIssues } from './ai-checks'

/** What to do after a pull request merges. */
export interface PostMergeConfig {
  /** Append the merged change to a changelog file */
  changelog?: { enabled?: boolean, path?: string }
  /** Comment on issues the pull request closed */
  commentOnIssues?: boolean
  /** Refresh the dependency dashboard */
  refreshDashboard?: boolean
}

/** What a post-merge pass did. */
export interface PostMergeOutcome {
  /** Actions that ran, named */
  performed: string[]
  /** Actions that were skipped, and why — never silently dropped */
  skipped: Array<{ action: string, reason: string }>
}

/** Where the changelog's unreleased section begins. */
const UNRELEASED_HEADING = /^##\s+\[?unreleased\]?/im

/**
 * Insert an entry into a changelog's unreleased section.
 *
 * Appends under an existing `## Unreleased` heading when there is one, and
 * creates the section otherwise. Never rewrites a released section: those
 * describe versions that shipped, and editing one makes the file disagree with
 * what people already installed.
 *
 * @param content - Current changelog, empty for a new file
 * @param entry - The line to add, without its bullet
 * @returns The updated changelog
 */
export function appendChangelogEntry(content: string, entry: string): string {
  const bullet = `- ${entry}`

  // Already recorded — a re-run of the workflow must not double the line.
  if (content.includes(bullet))
    return content

  const match = UNRELEASED_HEADING.exec(content)
  if (!match) {
    const header = content.trimStart().startsWith('#')
      ? content.replace(/(^#[^\n]*\n)/, `$1\n## Unreleased\n\n${bullet}\n`)
      : `# Changelog\n\n## Unreleased\n\n${bullet}\n\n${content}`
    return header
  }

  const insertAt = match.index + match[0].length
  const before = content.slice(0, insertAt)
  const after = content.slice(insertAt)

  // Placed directly under the heading, so the newest entry reads first.
  return `${before}\n\n${bullet}${after.replace(/^\n+/, '\n')}`
}

/**
 * Run the configured post-merge actions.
 *
 * Every action is independent and failure-tolerant: the pull request has
 * already merged, so nothing here can be undone by failing, and a changelog
 * that could not be written must not stop the linked issues from being
 * notified.
 *
 * @param provider - Provider to act through
 * @param pr - The merged pull request
 * @param config - Which actions to run
 * @param options - Base branch and logger
 * @returns What ran and what did not
 * @example
 * ```ts
 * const outcome = await runPostMerge(provider, pr, config.postMerge, { baseBranch: 'main' })
 * ```
 */
export async function runPostMerge(
  provider: GitProvider,
  pr: PullRequest,
  config: PostMergeConfig = {},
  options: { baseBranch?: string, logger?: Logger } = {},
): Promise<PostMergeOutcome> {
  const logger = options.logger ?? getDefaultLogger()
  const baseBranch = options.baseBranch ?? pr.base ?? 'main'

  const performed: string[] = []
  const skipped: PostMergeOutcome['skipped'] = []

  if (config.changelog?.enabled) {
    const path = config.changelog.path ?? 'CHANGELOG.md'

    try {
      const existing = await provider.getFileContent(path, baseBranch)
      const updated = appendChangelogEntry(existing ?? '', `${pr.title} (#${pr.number})`)

      if (updated === existing) {
        skipped.push({ action: 'changelog', reason: 'already recorded' })
      }
      else {
        await provider.commitChanges(
          baseBranch,
          `docs(changelog): record #${pr.number}`,
          [{ path, content: updated, type: existing === null ? 'create' : 'update' }],
          baseBranch,
        )
        performed.push('changelog')
      }
    }
    catch (error) {
      logger.warn(`⚠️ Could not update the changelog: ${error}`)
      skipped.push({ action: 'changelog', reason: 'write failed' })
    }
  }

  if (config.commentOnIssues) {
    const linked = findLinkedIssues(pr.body ?? '')

    if (linked.length === 0) {
      skipped.push({ action: 'comment-on-issues', reason: 'no linked issues' })
    }
    else {
      for (const number of linked) {
        try {
          // The issue is already closed by GitHub; this says *what* closed it,
          // which is the part a reader coming back to the issue wants.
          await provider.createComment(number, `Resolved by [#${pr.number}](${pr.url}) — ${pr.title}`)
          performed.push(`comment-on-issue-${number}`)
        }
        catch (error) {
          logger.warn(`⚠️ Could not comment on #${number}: ${error}`)
          skipped.push({ action: `comment-on-issue-${number}`, reason: 'comment failed' })
        }
      }
    }
  }

  if (config.refreshDashboard)
    performed.push('refresh-dashboard')

  return { performed, skipped }
}

/**
 * Whether a webhook payload describes a merged pull request.
 *
 * `pull_request: [closed]` fires for both merges and abandonments, and the
 * post-merge actions must not run for a pull request somebody gave up on.
 *
 * @param event - The webhook payload
 * @returns Whether this is a merge
 */
export function isMergeEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null)
    return false

  const payload = event as { action?: string, pull_request?: { merged?: boolean } }

  return payload.action === 'closed' && payload.pull_request?.merged === true
}
