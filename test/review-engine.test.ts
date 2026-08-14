import type { AiClient, AiCompletionRequest, AiResponse } from '../src/ai/types'
import type { ReviewFinding } from '../src/review/findings'
import { describe, expect, it } from 'bun:test'
import { parseUnifiedDiff, renderDiffForReview } from '../src/review/diff'
import { defaultIncludePath, reviewDiff } from '../src/review/engine'
import { dedupeFindings, fingerprint, validateFindings } from '../src/review/findings'
import { needsReview, parseReviewState, serializeReviewState } from '../src/review/marker'
import { prepareReview, renderFinding } from '../src/review/poster'

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,8 @@ export function start() {
   const config = load()
   const server = createServer()
+  const token = process.env.SECRET
+  console.log(token)
   server.listen(3000)
   return server
 }
diff --git a/bun.lock b/bun.lock
index 3333333..4444444 100644
--- a/bun.lock
+++ b/bun.lock
@@ -1,3 +1,3 @@
-  "typescript": "5.8.2"
+  "typescript": "5.8.3"
`

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    path: 'src/app.ts',
    line: 12,
    severity: 'major',
    category: 'security',
    message: 'Secret is logged to stdout',
    ...overrides,
  }
}

/** An AI client returning one scripted structured response. */
function scriptedClient(json: unknown): AiClient & { requests: AiCompletionRequest[] } {
  const requests: AiCompletionRequest[] = []
  return {
    provider: 'anthropic',
    model: 'test-model',
    tokensUsed: 0,
    requests,
    async complete(request): Promise<AiResponse> {
      requests.push(request)
      return {
        text: JSON.stringify(json),
        toolCalls: [],
        json,
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5 },
        model: 'test-model',
      }
    },
  }
}

describe('diff parsing', () => {
  it('success case - finds changed files and their status', () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF)

    expect(parsed.files.map(file => file.path)).toEqual(['src/app.ts', 'bun.lock'])
    expect(parsed.files[0].status).toBe('modified')
  })

  it('success case - maps commentable lines on the head side', () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF)
    const lines = parsed.files[0].commentableLines

    // The hunk starts at line 10; the two added lines land at 12 and 13.
    expect(lines.has(12)).toBe(true)
    expect(lines.has(13)).toBe(true)
    expect(lines.has(999)).toBe(false)
  })

  it('success case - counts changed lines', () => {
    expect(parseUnifiedDiff(SAMPLE_DIFF).changedLines).toBe(4)
  })

  it('edge case - detects added and deleted files', () => {
    const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const a = 1
+export const b = 2
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const old = true
`
    const parsed = parseUnifiedDiff(diff)

    expect(parsed.files[0].status).toBe('added')
    expect(parsed.files[1].status).toBe('deleted')
  })

  it('edge case - detects renames', () => {
    const diff = 'diff --git a/old.ts b/new.ts\nsimilarity index 95%\n--- a/old.ts\n+++ b/new.ts\n'
    const parsed = parseUnifiedDiff(diff)

    expect(parsed.files[0]).toMatchObject({ path: 'new.ts', previousPath: 'old.ts', status: 'renamed' })
  })

  it('edge case - returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('').files).toEqual([])
  })
})

describe('diff filtering', () => {
  it('success case - excludes lock files from review', () => {
    // Lock files are most of a dependency PR's diff and hold no decisions.
    expect(defaultIncludePath('bun.lock')).toBe(false)
    expect(defaultIncludePath('package-lock.json')).toBe(false)
    expect(defaultIncludePath('dist/index.js')).toBe(false)
    expect(defaultIncludePath('src/app.ts')).toBe(true)
  })

  it('success case - reports what it left out rather than dropping it silently', () => {
    const rendered = renderDiffForReview(parseUnifiedDiff(SAMPLE_DIFF), { include: defaultIncludePath })

    expect(rendered.files.map(file => file.path)).toEqual(['src/app.ts'])
    expect(rendered.omitted).toEqual(['bun.lock'])
  })

  it('edge case - truncates a file larger than the per-file cap', () => {
    const huge = `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -1,1 +1,1 @@\n${'+x\n'.repeat(5000)}`
    const rendered = renderDiffForReview(parseUnifiedDiff(huge), { maxCharsPerFile: 500 })

    expect(rendered.text).toContain('[file truncated]')
  })
})

describe('finding validation', () => {
  const anchors = new Map([['src/app.ts', new Set([12, 13])]])

  it('success case - keeps a finding anchored to a changed line', () => {
    const { valid, dropped } = validateFindings([makeFinding()], anchors)

    expect(valid).toHaveLength(1)
    expect(dropped).toHaveLength(0)
  })

  it('failure case - drops a finding on a line the diff does not touch', () => {
    // Relocating it would present a guess as a located defect.
    const { valid, dropped } = validateFindings([makeFinding({ line: 500 })], anchors)

    expect(valid).toHaveLength(0)
    expect(dropped).toHaveLength(1)
  })

  it('failure case - drops a finding on a file that is not in the diff', () => {
    const { valid } = validateFindings([makeFinding({ path: 'other.ts' })], anchors)

    expect(valid).toHaveLength(0)
  })

  it('success case - orders findings by severity', () => {
    const findings = [
      makeFinding({ severity: 'nit', line: 12 }),
      makeFinding({ severity: 'critical', line: 13, message: 'crit' }),
      makeFinding({ severity: 'minor', line: 12, message: 'min' }),
    ]

    const { valid } = validateFindings(findings, anchors)

    expect(valid.map(finding => finding.severity)).toEqual(['critical', 'minor', 'nit'])
  })
})

describe('finding fingerprints', () => {
  it('success case - is stable when only the line moves', () => {
    // An unrelated edit above a finding must not make it look new.
    expect(fingerprint(makeFinding({ line: 12 }))).toBe(fingerprint(makeFinding({ line: 40 })))
  })

  it('success case - differs by file, category and message', () => {
    expect(fingerprint(makeFinding())).not.toBe(fingerprint(makeFinding({ path: 'other.ts' })))
    expect(fingerprint(makeFinding())).not.toBe(fingerprint(makeFinding({ category: 'style' })))
    expect(fingerprint(makeFinding())).not.toBe(fingerprint(makeFinding({ message: 'different' })))
  })

  it('success case - skips findings already reported', () => {
    const seen = new Set([fingerprint(makeFinding())])

    expect(dedupeFindings([makeFinding({ line: 99 })], seen)).toHaveLength(0)
  })

  it('success case - deduplicates within one batch', () => {
    expect(dedupeFindings([makeFinding(), makeFinding({ line: 13 })], new Set())).toHaveLength(1)
  })
})

describe('review state marker', () => {
  it('success case - round-trips', () => {
    const body = `summary\n\n${serializeReviewState({
      reviewedSha: 'abc123',
      fingerprints: ['a', 'b'],
      reviewedAt: '2026-08-14T00:00:00.000Z',
    })}`

    const state = parseReviewState(body)

    expect(state?.reviewedSha).toBe('abc123')
    expect(state?.fingerprints).toEqual(['a', 'b'])
  })

  it('failure case - returns null for a body without a marker', () => {
    expect(parseReviewState('just a comment')).toBeNull()
  })

  it('failure case - returns null for malformed state instead of throwing', () => {
    expect(() => parseReviewState('<!-- buddy-bot:review v1\n{bad\n-->')).not.toThrow()
    expect(parseReviewState('<!-- buddy-bot:review v1\n{bad\n-->')).toBeNull()
  })

  it('success case - a new commit needs review', () => {
    const state = parseReviewState(serializeReviewState({
      reviewedSha: 'old',
      fingerprints: [],
      reviewedAt: new Date().toISOString(),
    }))

    expect(needsReview(state, 'new')).toBe(true)
    expect(needsReview(state, 'old')).toBe(false)
  })

  it('success case - a paused PR is never reviewed', () => {
    const state = parseReviewState(`<!-- buddy-bot:review v1\n{"reviewedSha":"x","paused":true}\n-->`)

    expect(needsReview(state, 'anything-new')).toBe(false)
  })
})

describe('review rendering', () => {
  it('success case - renders a finding with severity and category', () => {
    const body = renderFinding(makeFinding())

    expect(body).toContain('major')
    expect(body).toContain('security')
    expect(body).toContain('Secret is logged to stdout')
  })

  it('success case - renders a committable suggestion block', () => {
    const body = renderFinding(makeFinding({ suggestion: 'const token = redact(process.env.SECRET)' }))

    expect(body).toContain('```suggestion')
    expect(body).toContain('const token = redact')
  })

  it('success case - omits the suggestion block when there is no mechanical fix', () => {
    expect(renderFinding(makeFinding())).not.toContain('```suggestion')
  })

  it('success case - builds a review with inline comments and state', () => {
    const prepared = prepareReview(
      { summary: 'Adds logging.', walkthrough: [], findings: [makeFinding()], effort: 2, omittedFiles: [] },
      { headSha: 'sha123' },
    )

    expect(prepared.comments).toHaveLength(1)
    expect(prepared.comments[0]).toMatchObject({ path: 'src/app.ts', line: 12, side: 'RIGHT' })
    expect(parseReviewState(prepared.body)?.reviewedSha).toBe('sha123')
  })

  it('success case - says so plainly when nothing was found', () => {
    const prepared = prepareReview(
      { summary: 'Routine bump.', walkthrough: [], findings: [], effort: 1, omittedFiles: [] },
      { headSha: 'sha' },
    )

    expect(prepared.body).toContain('**Findings:** none.')
    expect(prepared.event).toBe('COMMENT')
  })

  it('success case - reports omitted files rather than implying full coverage', () => {
    const prepared = prepareReview(
      { summary: 's', walkthrough: [], findings: [], effort: 1, omittedFiles: ['bun.lock'] },
      { headSha: 'sha' },
    )

    expect(prepared.body).toContain('1 file(s) not reviewed')
    expect(prepared.body).toContain('bun.lock')
  })

  it('success case - requests changes only when configured and warranted', () => {
    const critical = { summary: 's', walkthrough: [], findings: [makeFinding({ severity: 'critical' as const })], effort: 3, omittedFiles: [] }

    expect(prepareReview(critical, { headSha: 'x', requestChangesOn: 'critical' }).event).toBe('REQUEST_CHANGES')
    expect(prepareReview(critical, { headSha: 'x' }).event).toBe('COMMENT')
    expect(prepareReview(
      { ...critical, findings: [makeFinding({ severity: 'minor' as const })] },
      { headSha: 'x', requestChangesOn: 'critical' },
    ).event).toBe('COMMENT')
  })

  it('edge case - escapes table-breaking characters in the walkthrough', () => {
    const prepared = prepareReview(
      { summary: 's', walkthrough: [{ path: 'a|b.ts', description: 'fixes #123' }], findings: [], effort: 1, omittedFiles: [] },
      { headSha: 'x' },
    )

    expect(prepared.body).toContain('a\\|b.ts')
    // A bare #123 would notify an unrelated issue.
    expect(prepared.body).not.toContain('fixes #123')
  })
})

describe('reviewDiff', () => {
  it('success case - returns validated findings from the model', async () => {
    const ai = scriptedClient({
      summary: 'Adds a debug log that prints a secret.',
      effort: 2,
      walkthrough: [{ path: 'src/app.ts', description: 'Adds logging' }],
      findings: [{
        path: 'src/app.ts',
        line: 13,
        severity: 'major',
        category: 'security',
        message: 'Logs a secret to stdout',
      }],
    })

    const result = await reviewDiff(ai, { diff: SAMPLE_DIFF })

    expect(result.summary).toContain('secret')
    expect(result.findings).toHaveLength(1)
    expect(result.effort).toBe(2)
  })

  it('failure case - discards a hallucinated anchor', async () => {
    const ai = scriptedClient({
      summary: 's',
      effort: 1,
      walkthrough: [],
      findings: [{ path: 'src/nonexistent.ts', line: 5, severity: 'major', category: 'x', message: 'y' }],
    })

    const result = await reviewDiff(ai, { diff: SAMPLE_DIFF })

    expect(result.findings).toHaveLength(0)
  })

  it('success case - does not send excluded files to the model', async () => {
    const ai = scriptedClient({ summary: 's', effort: 1, walkthrough: [], findings: [] })

    await reviewDiff(ai, { diff: SAMPLE_DIFF })

    const prompt = ai.requests[0].messages[0].content
    expect(prompt).toContain('src/app.ts')
    expect(prompt).not.toContain('bun.lock')
  })

  it('success case - skips findings reported by an earlier review', async () => {
    const ai = scriptedClient({
      summary: 's',
      effort: 1,
      walkthrough: [],
      findings: [{ path: 'src/app.ts', line: 12, severity: 'major', category: 'security', message: 'Secret is logged to stdout' }],
    })

    const result = await reviewDiff(ai, {
      diff: SAMPLE_DIFF,
      seenFingerprints: [fingerprint(makeFinding())],
    })

    expect(result.findings).toHaveLength(0)
  })

  it('success case - summary-only mode reports no findings', async () => {
    const ai = scriptedClient({
      summary: 'A summary.',
      effort: 1,
      walkthrough: [],
      findings: [{ path: 'src/app.ts', line: 12, severity: 'major', category: 'x', message: 'y' }],
    })

    const result = await reviewDiff(ai, { diff: SAMPLE_DIFF, summaryOnly: true })

    expect(result.summary).toBe('A summary.')
    expect(result.findings).toHaveLength(0)
  })

  it('edge case - a diff of only excluded files reviews nothing', async () => {
    const ai = scriptedClient({ summary: 'unused', effort: 1, walkthrough: [], findings: [] })
    const lockOnly = SAMPLE_DIFF.slice(SAMPLE_DIFF.indexOf('diff --git a/bun.lock'))

    const result = await reviewDiff(ai, { diff: lockOnly })

    expect(result.findings).toHaveLength(0)
    expect(ai.requests).toHaveLength(0)
  })

  it('success case - profile changes the instructions sent', async () => {
    const ai = scriptedClient({ summary: 's', effort: 1, walkthrough: [], findings: [] })

    await reviewDiff(ai, { diff: SAMPLE_DIFF, profile: 'assertive' })

    expect(ai.requests[0].system).toContain('less certain')
  })
})
