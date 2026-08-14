/**
 * Actions a maintainer requested by ticking checkboxes on the dependency
 * dashboard issue.
 */
export interface DashboardActions {
  /** Branches whose PRs should be rebased */
  rebaseBranches: string[]
  /** Whether every open buddy-bot PR should be rebased */
  rebaseAll: boolean
  /** Whether a full scan-and-update run was requested */
  manualRun: boolean
}

/** A ticked checkbox: `- [x]` with optional leading whitespace. */
const CHECKED = String.raw`^\s*-\s*\[[xX]\]\s*`

const REBASE_BRANCH_LINE = new RegExp(`${CHECKED}<!--\\s*rebase-branch=([^>]*?)\\s*-->`, 'gm')
const REBASE_ALL_LINE = new RegExp(`${CHECKED}<!--\\s*rebase-all-open-prs\\s*-->`, 'm')
const MANUAL_JOB_LINE = new RegExp(`${CHECKED}<!--\\s*manual job\\s*-->`, 'm')

/**
 * Reads the checkboxes a maintainer ticked on the dashboard issue.
 *
 * Only ticked boxes are reported; the unticked markers the dashboard always
 * renders are ignored.
 *
 * @param body - Dashboard issue body
 * @returns The requested actions, all empty when nothing was ticked
 * @example
 * ```ts
 * const actions = parseDashboardActions(issue.body)
 * for (const branch of actions.rebaseBranches)
 *   await rebaseBranch(branch)
 * ```
 */
export function parseDashboardActions(body: string | null | undefined): DashboardActions {
  if (!body)
    return { rebaseBranches: [], rebaseAll: false, manualRun: false }

  const rebaseBranches: string[] = []
  for (const match of body.matchAll(REBASE_BRANCH_LINE)) {
    const branch = match[1].trim()
    if (branch && !rebaseBranches.includes(branch))
      rebaseBranches.push(branch)
  }

  return {
    rebaseBranches,
    rebaseAll: REBASE_ALL_LINE.test(body),
    manualRun: MANUAL_JOB_LINE.test(body),
  }
}

/**
 * Reports whether any action was requested.
 *
 * @param actions - Parsed dashboard actions
 */
export function hasDashboardActions(actions: DashboardActions): boolean {
  return actions.rebaseBranches.length > 0 || actions.rebaseAll || actions.manualRun
}

/**
 * Unticks every dashboard checkbox so a handled request is not replayed on the
 * next run.
 *
 * Only the boxes buddy-bot owns are touched — a checkbox a maintainer added to
 * the issue by hand is left alone.
 *
 * @param body - Dashboard issue body
 * @returns The body with all buddy-bot checkboxes cleared
 */
export function uncheckDashboardActions(body: string): string {
  return body.replace(
    /^(\s*-\s*)\[[xX]\](\s*<!--\s*(?:rebase-branch=[^>]*?|rebase-all-open-prs|manual job)\s*-->)/gm,
    '$1[ ]$2',
  )
}
