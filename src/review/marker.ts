/** Review state carried in a hidden comment on the pull request. */
export interface ReviewState {
  schemaVersion: number
  /** Head SHA of the last commit reviewed */
  reviewedSha: string
  /** Fingerprints of findings already reported */
  fingerprints: string[]
  /** ISO timestamp of the last review */
  reviewedAt: string
  /** Set when a maintainer paused reviews on this PR */
  paused?: boolean
}

const MARKER_OPEN = '<!-- buddy-bot:review'
const MARKER_REGEX = /<!--\s*buddy-bot:review\s+v(\d+)\s*([\s\S]*?)-->/

/** Schema version emitted by this build. */
export const REVIEW_STATE_VERSION = 1

/**
 * Render review state as a hidden comment.
 *
 * Stored on the pull request rather than in a database because the runtime is
 * a CI job with no storage of its own — the PR is the only place state can
 * live that both survives the run and stays visible to maintainers.
 *
 * @param state - State to persist
 */
export function serializeReviewState(state: Omit<ReviewState, 'schemaVersion'>): string {
  const payload: ReviewState = { schemaVersion: REVIEW_STATE_VERSION, ...state }
  return `${MARKER_OPEN} v${REVIEW_STATE_VERSION}\n${JSON.stringify(payload)}\n-->`
}

/**
 * Read review state back out of a comment body.
 *
 * @param body - Comment body, possibly null
 * @returns The state, or `null` when absent or unreadable
 */
export function parseReviewState(body: string | null | undefined): ReviewState | null {
  if (!body)
    return null

  const match = body.match(MARKER_REGEX)
  if (!match)
    return null

  try {
    const parsed = JSON.parse(match[2].trim()) as Partial<ReviewState>
    if (typeof parsed.reviewedSha !== 'string')
      return null

    return {
      schemaVersion: Number(parsed.schemaVersion) || REVIEW_STATE_VERSION,
      reviewedSha: parsed.reviewedSha,
      fingerprints: Array.isArray(parsed.fingerprints) ? parsed.fingerprints.filter(f => typeof f === 'string') : [],
      reviewedAt: typeof parsed.reviewedAt === 'string' ? parsed.reviewedAt : new Date(0).toISOString(),
      ...(parsed.paused ? { paused: true } : {}),
    }
  }
  catch {
    return null
  }
}

/**
 * Whether a pull request needs reviewing.
 *
 * @param state - Previous review state, if any
 * @param headSha - Current head commit
 */
export function needsReview(state: ReviewState | null, headSha: string): boolean {
  if (state?.paused)
    return false

  return state?.reviewedSha !== headSha
}
