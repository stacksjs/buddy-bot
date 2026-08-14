import type { ReviewFinding, ReviewResult } from './findings'
import { fingerprint } from './findings'
import { serializeReviewState } from './marker'

/** Emoji per severity, matching the dashboard's visual language. */
const SEVERITY_BADGE: Record<ReviewFinding['severity'], string> = {
  critical: '🔴 critical',
  major: '🟠 major',
  minor: '🟡 minor',
  nit: '⚪ nit',
}

/** An inline comment ready for the review API. */
export interface InlineComment {
  path: string
  line: number
  side: 'RIGHT'
  body: string
}

/** A complete review, ready to post. */
export interface PreparedReview {
  /** Summary comment body, including the state marker */
  body: string
  comments: InlineComment[]
  /** `REQUEST_CHANGES` only when configured and warranted */
  event: 'COMMENT' | 'REQUEST_CHANGES'
}

/**
 * Render one finding as an inline comment.
 *
 * A suggestion is emitted as a GitHub suggestion block so a maintainer can
 * commit it from the review thread; findings without a mechanical fix render
 * as prose only, since a half-right suggestion costs more to undo than to
 * write by hand.
 *
 * @param finding - Finding to render
 */
export function renderFinding(finding: ReviewFinding): string {
  const source = finding.tool ? ` \`[${finding.tool}]\`` : ''
  let body = `**${SEVERITY_BADGE[finding.severity]}** · \`${finding.category}\`${source}\n\n${finding.message}`

  if (finding.suggestion) {
    body += `\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``
  }

  return body
}

/**
 * Build the summary comment and inline comments for a review.
 *
 * @param result - Review output
 * @param options - Head SHA to record and gating behaviour
 * @returns A review ready to hand to the provider
 */
export function prepareReview(
  result: ReviewResult,
  options: {
    headSha: string
    /** Severity at which to request changes rather than comment */
    requestChangesOn?: 'never' | 'critical'
    /** Fingerprints already reported, carried forward into the new state */
    seenFingerprints?: string[]
  },
): PreparedReview {
  const comments: InlineComment[] = result.findings.map(finding => ({
    path: finding.path,
    line: finding.line,
    side: 'RIGHT' as const,
    body: renderFinding(finding),
  }))

  const counts = countBySeverity(result.findings)
  const hasCritical = counts.critical > 0

  const fingerprints = [
    ...new Set([...(options.seenFingerprints ?? []), ...result.findings.map(fingerprint)]),
  ]

  return {
    body: renderSummary(result, counts, options.headSha, fingerprints),
    comments,
    event: options.requestChangesOn === 'critical' && hasCritical ? 'REQUEST_CHANGES' : 'COMMENT',
  }
}

function renderSummary(
  result: ReviewResult,
  counts: Record<ReviewFinding['severity'], number>,
  headSha: string,
  fingerprints: string[],
): string {
  let body = `## 🔍 Review\n\n${result.summary || '_No summary produced._'}\n\n`

  const total = result.findings.length
  const effortBar = '●'.repeat(result.effort) + '○'.repeat(5 - result.effort)
  body += `**Review effort:** ${effortBar} (${result.effort}/5)\n\n`

  if (total === 0) {
    body += '**Findings:** none.\n\n'
  }
  else {
    const parts = (Object.keys(SEVERITY_BADGE) as ReviewFinding['severity'][])
      .filter(severity => counts[severity] > 0)
      .map(severity => `${counts[severity]} ${severity}`)
    body += `**Findings:** ${total} (${parts.join(', ')}) — see the inline comments.\n\n`
  }

  if (result.walkthrough.length > 0) {
    body += '<details><summary>Walkthrough</summary>\n\n| File | Change |\n|---|---|\n'
    for (const entry of result.walkthrough)
      body += `| \`${escapeCell(entry.path)}\` | ${escapeCell(entry.description)} |\n`
    body += '\n</details>\n\n'
  }

  if (result.omittedFiles.length > 0) {
    // Silent truncation reads as "reviewed everything" when it did not.
    body += `<details><summary>${result.omittedFiles.length} file(s) not reviewed</summary>\n\n`
    body += `${result.omittedFiles.map(path => `- \`${escapeCell(path)}\``).join('\n')}\n\n</details>\n\n`
  }

  body += '---\n\nReply to any comment to discuss it, or comment `@buddy-bot pause` to stop reviewing this PR.\n'
  body += serializeReviewState({
    reviewedSha: headSha,
    fingerprints,
    reviewedAt: new Date().toISOString(),
  })

  return body
}

function countBySeverity(findings: ReviewFinding[]): Record<ReviewFinding['severity'], number> {
  const counts = { critical: 0, major: 0, minor: 0, nit: 0 }
  for (const finding of findings)
    counts[finding.severity]++
  return counts
}

/** Keep a table cell from breaking the table or opening a reference link. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/#(\d)/g, '#​$1')
}
