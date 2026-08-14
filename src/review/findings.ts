/** How much a finding matters, ordered from most to least severe. */
export type FindingSeverity = 'critical' | 'major' | 'minor' | 'nit'

/** Severities in descending order, for sorting and threshold checks. */
export const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'major', 'minor', 'nit']

/** A single reviewable issue. */
export interface ReviewFinding {
  /** Repository-relative path */
  path: string
  /** Line on the head side of the diff */
  line: number
  severity: FindingSeverity
  /** Short category slug, e.g. `correctness`, `security` */
  category: string
  /** What is wrong and why it matters */
  message: string
  /**
   * Replacement for the flagged line(s), when the fix is mechanical. Rendered
   * as a committable suggestion.
   */
  suggestion?: string
  /** Tool that produced the finding; absent for model findings */
  tool?: string
}

/** What a review produced. */
export interface ReviewResult {
  /** One-paragraph summary of the change */
  summary: string
  /** Per-file notes for the walkthrough table */
  walkthrough: Array<{ path: string, description: string }>
  findings: ReviewFinding[]
  /** Rough reviewer effort, 1 (trivial) to 5 (demanding) */
  effort: number
  /** Files excluded from review, so the report can say so */
  omittedFiles: string[]
}

/**
 * JSON Schema the model's review output is validated against.
 *
 * Constrained rather than free-form so a finding either anchors to a real file
 * and line or fails validation — a review that renders as prose is impossible
 * to post as inline comments.
 */
export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One paragraph on what this change does' },
    effort: { type: 'integer', description: 'Reviewer effort, 1 (trivial) to 5 (demanding)' },
    walkthrough: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['path', 'description'],
        additionalProperties: false,
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository-relative path' },
          line: { type: 'integer', description: 'Line number on the new side of the diff' },
          severity: { type: 'string', enum: SEVERITY_ORDER },
          category: { type: 'string', description: 'Short slug, e.g. correctness or security' },
          message: { type: 'string', description: 'What is wrong and why it matters' },
          suggestion: { type: 'string', description: 'Replacement code, only when the fix is mechanical' },
        },
        required: ['path', 'line', 'severity', 'category', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'effort', 'walkthrough', 'findings'],
  additionalProperties: false,
}

/**
 * A stable identity for a finding, used to avoid re-posting it.
 *
 * Deliberately excludes the line number: a finding that survives an unrelated
 * edit above it moves line but stays the same finding, and re-posting it on
 * every push is the fastest way to make a review bot ignorable.
 *
 * @param finding - Finding to identify
 */
export function fingerprint(finding: ReviewFinding): string {
  const normalized = finding.message.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)
  return `${finding.path}:${finding.category}:${normalized}`
}

/**
 * Drop findings that cannot be anchored, then order them by severity.
 *
 * A finding on a line the diff does not touch is rejected outright rather than
 * relocated: the model has misread the diff, and moving the comment somewhere
 * plausible would present a guess as a located defect.
 *
 * @param findings - Raw findings from the model or a tool
 * @param anchors - Commentable lines per path
 * @returns Anchorable findings, most severe first, and the count dropped
 */
export function validateFindings(
  findings: ReviewFinding[],
  anchors: Map<string, Set<number>>,
): { valid: ReviewFinding[], dropped: ReviewFinding[] } {
  const valid: ReviewFinding[] = []
  const dropped: ReviewFinding[] = []

  for (const finding of findings) {
    const lines = anchors.get(finding.path)
    if (lines?.has(finding.line))
      valid.push(finding)
    else
      dropped.push(finding)
  }

  valid.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))

  return { valid, dropped }
}

/**
 * Remove findings that duplicate one already reported.
 *
 * @param findings - Candidate findings
 * @param seen - Fingerprints already posted on this pull request
 */
export function dedupeFindings(findings: ReviewFinding[], seen: Set<string>): ReviewFinding[] {
  const fresh: ReviewFinding[] = []
  const local = new Set<string>()

  for (const finding of findings) {
    const key = fingerprint(finding)
    if (seen.has(key) || local.has(key))
      continue

    local.add(key)
    fresh.push(finding)
  }

  return fresh
}
