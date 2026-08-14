import type { AiClient } from '../ai/types'
import type { Logger } from '../utils/logger'
import type { ParsedDiff } from './diff'
import type { ReviewFinding, ReviewResult } from './findings'
import { getDefaultLogger } from '../utils/logger'
import { parseUnifiedDiff, renderDiffForReview } from './diff'
import { dedupeFindings, REVIEW_SCHEMA, validateFindings } from './findings'

/** Paths excluded from review unless a config says otherwise. */
export const DEFAULT_EXCLUDED_PATHS: RegExp[] = [
  /(?:^|\/)(?:bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|pantry\.lock)$/,
  /(?:^|\/)(?:dist|build|out|coverage|node_modules|vendor)\//,
  /\.min\.(?:js|css)$/,
  /(?:^|\/)(?:.*\.snap)$/,
]

/** How thorough a review to run. */
export type ReviewProfile = 'chill' | 'assertive'

/** Inputs to a review. */
export interface ReviewOptions {
  /** Unified diff text to review */
  diff: string
  /** How thorough to be (default: chill) */
  profile?: ReviewProfile
  /** Extra guidance from config or repository conventions */
  instructions?: string
  /** Fingerprints already reported, so they are not repeated */
  seenFingerprints?: string[]
  /** Return only the summary and walkthrough, skipping findings */
  summaryOnly?: boolean
  /** Additional context, such as dependency release notes */
  context?: string
  /** Whether to include a path in the review */
  includePath?: (path: string) => boolean
  logger?: Logger
}

/** Framing shared by both profiles. */
const BASE_SYSTEM = `You are reviewing a pull request diff.

Report only defects you can point at in the diff. A review that invents
findings to look thorough is worse than one that reports nothing, so say
plainly when a change looks fine.

Every finding must name a file and a line number that appears in the diff you
were given. Do not report findings about code you cannot see.

Only include a suggestion when the fix is mechanical and you can write the
replacement exactly. Omit it for anything requiring judgement.`

const PROFILE_GUIDANCE: Record<ReviewProfile, string> = {
  chill: `Report only findings you are confident are real defects: correctness
bugs, security problems, and changes that break existing behaviour. Skip style
preferences, naming opinions, and speculative concerns.`,

  assertive: `Report correctness, security, performance, and maintainability
findings, including ones you are less certain about. Mark uncertain findings
as minor or nit so they can be filtered downstream, and still skip pure style
preferences.`,
}

/**
 * Review a diff and return validated findings.
 *
 * Findings are validated against the diff's own line map rather than trusted:
 * a finding on a line the diff does not touch means the model misread it, and
 * relocating the comment would present a guess as a located defect.
 *
 * @param ai - Configured AI client
 * @param options - Diff and review settings
 * @returns Summary, walkthrough and anchorable findings
 * @example
 * ```ts
 * const result = await reviewDiff(ai, { diff: await collectGitDiff('main') })
 * console.log(result.findings.length)
 * ```
 */
export async function reviewDiff(ai: AiClient, options: ReviewOptions): Promise<ReviewResult> {
  const logger = options.logger ?? getDefaultLogger()
  const profile = options.profile ?? 'chill'
  const parsed = parseUnifiedDiff(options.diff)

  const include = options.includePath ?? defaultIncludePath
  const rendered = renderDiffForReview(parsed, { include })

  if (rendered.files.length === 0) {
    logger.info('🔍 Nothing to review after filtering generated and lock files')
    return { summary: 'No reviewable changes.', walkthrough: [], findings: [], effort: 1, omittedFiles: rendered.omitted }
  }

  logger.info(`🔍 Reviewing ${rendered.files.length} file(s), ${parsed.changedLines} changed line(s)`)

  const system = [
    BASE_SYSTEM,
    PROFILE_GUIDANCE[profile],
    options.summaryOnly ? 'Return an empty findings array; only the summary and walkthrough are wanted.' : '',
    options.instructions ? `Repository-specific guidance:\n${options.instructions}` : '',
  ].filter(Boolean).join('\n\n')

  const userContent = [
    options.context ? `Context:\n${options.context}\n` : '',
    'Diff:\n',
    rendered.text,
  ].join('')

  const response = await ai.complete({
    system,
    messages: [{ role: 'user', content: userContent }],
    jsonSchema: REVIEW_SCHEMA,
  })

  const payload = (response.json ?? {}) as Partial<ReviewResult>
  const anchors = anchorMap(parsed)

  const raw = Array.isArray(payload.findings) ? payload.findings as ReviewFinding[] : []
  const { valid, dropped } = validateFindings(raw, anchors)

  if (dropped.length > 0)
    logger.debug(`🔍 Dropped ${dropped.length} finding(s) that did not anchor to a changed line`)

  const fresh = dedupeFindings(valid, new Set(options.seenFingerprints ?? []))
  if (fresh.length < valid.length)
    logger.debug(`🔍 Skipped ${valid.length - fresh.length} finding(s) already reported`)

  return {
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    walkthrough: Array.isArray(payload.walkthrough) ? payload.walkthrough : [],
    findings: options.summaryOnly ? [] : fresh,
    effort: clampEffort(payload.effort),
    omittedFiles: rendered.omitted,
  }
}

/** Commentable lines per path, for anchor validation. */
export function anchorMap(diff: ParsedDiff): Map<string, Set<number>> {
  return new Map(diff.files.map(file => [file.path, file.commentableLines]))
}

/**
 * Whether a path is worth reviewing by default.
 *
 * Lock files and build output are most of a dependency PR's diff and contain
 * no reviewable decisions.
 */
export function defaultIncludePath(path: string): boolean {
  return !DEFAULT_EXCLUDED_PATHS.some(pattern => pattern.test(path))
}

function clampEffort(value: unknown): number {
  const effort = Number(value)
  if (!Number.isFinite(effort))
    return 3
  return Math.min(5, Math.max(1, Math.round(effort)))
}
