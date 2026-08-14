import type { ReviewFinding, ReviewResult } from '../src/review/findings'
import { describe, expect, it } from 'bun:test'
import {
  applySuggestion,
  countBySeverity,
  diffArgsFor,
  formatAgent,
  formatGithub,
  formatPretty,
  formatReview,
  REVIEW_FORMATS,
  shouldFail,
} from '../src/review/local'

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    path: 'src/app.ts',
    line: 10,
    severity: 'major',
    category: 'correctness',
    message: 'This can be undefined',
    ...overrides,
  }
}

function result(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    summary: 'Adds a handler.',
    walkthrough: [],
    findings: [],
    effort: 2,
    omittedFiles: [],
    ...overrides,
  }
}

describe('diff modes', () => {
  it('success case - staged reviews the index', () => {
    expect(diffArgsFor('staged', 'main')).toContain('--cached')
  })

  it('success case - branch uses three-dot against the base', () => {
    // Three-dot is what this branch added, not what the base moved on to.
    expect(diffArgsFor('branch', 'main')).toContain('main...HEAD')
  })

  it('success case - working includes staged changes', () => {
    // A pre-commit review that ignored what you just staged would miss the
    // very changes you are about to commit.
    expect(diffArgsFor('working', 'main')).toContain('HEAD')
    expect(diffArgsFor('working', 'main')).not.toContain('--cached')
  })
})

describe('pretty output', () => {
  it('success case - groups findings by file', () => {
    const output = formatPretty(result({
      findings: [
        finding({ path: 'b.ts', line: 2 }),
        finding({ path: 'a.ts', line: 1 }),
        finding({ path: 'a.ts', line: 3 }),
      ],
    }))

    expect(output).toContain('a.ts')
    expect(output).toContain('b.ts')
    expect(output).toContain('3 finding(s)')
  })

  it('success case - orders findings within a file by line', () => {
    const output = formatPretty(result({
      findings: [finding({ line: 30, message: 'later' }), finding({ line: 5, message: 'earlier' })],
    }))

    expect(output.indexOf('earlier')).toBeLessThan(output.indexOf('later'))
  })

  it('success case - names the tool that produced a finding', () => {
    expect(formatPretty(result({ findings: [finding({ tool: 'shellcheck' })] }))).toContain('[shellcheck]')
  })

  it('success case - says plainly when there is nothing to report', () => {
    expect(formatPretty(result())).toContain('Nothing to report')
  })

  it('success case - reports files that were not reviewed', () => {
    // Silence would read as "reviewed and clean".
    expect(formatPretty(result({ omittedFiles: ['bun.lock'] }))).toContain('bun.lock')
  })
})

describe('github annotation output', () => {
  it('success case - maps severity onto annotation levels', () => {
    const output = formatGithub(result({
      findings: [finding({ severity: 'critical' }), finding({ severity: 'nit', line: 2 })],
    }))

    expect(output).toContain('::error file=src/app.ts,line=10::')
    expect(output).toContain('::warning file=src/app.ts,line=2::')
  })

  it('success case - escapes newlines and percent signs', () => {
    // An unescaped newline truncates the annotation at that point.
    const output = formatGithub(result({ findings: [finding({ message: 'a\nb 50% off' })] }))

    expect(output).toContain('a%0Ab 50%25 off')
    expect(output.split('\n')).toHaveLength(1)
  })

  it('edge case - no findings produces no annotations', () => {
    expect(formatGithub(result())).toBe('')
  })
})

describe('agent output', () => {
  it('success case - reads as an instruction, not a report', () => {
    const output = formatAgent(result({ findings: [finding()] }))

    expect(output).toContain('Fix the code review findings')
    expect(output).toContain('src/app.ts:10')
  })

  it('success case - tells the agent not to refactor beyond the findings', () => {
    expect(formatAgent(result({ findings: [finding()] }))).toContain('Do not refactor')
  })

  it('success case - gives the agent permission to disagree', () => {
    // An agent that mechanically applies a wrong finding is worse than one
    // that pushes back.
    expect(formatAgent(result({ findings: [finding()] }))).toContain('disagree')
  })

  it('success case - passes suggestions through', () => {
    const output = formatAgent(result({ findings: [finding({ suggestion: 'const x = y ?? 1' })] }))

    expect(output).toContain('const x = y ?? 1')
  })

  it('edge case - a clean review says so without instructions', () => {
    expect(formatAgent(result())).toContain('nothing to fix')
  })
})

describe('format dispatch', () => {
  it('success case - json output round-trips', () => {
    const output = formatReview(result({ findings: [finding()] }), 'json')

    expect(JSON.parse(output).findings).toHaveLength(1)
  })

  it('success case - every advertised format renders', () => {
    for (const format of REVIEW_FORMATS)
      expect(formatReview(result({ findings: [finding()] }), format).length).toBeGreaterThan(0)
  })
})

describe('applying suggestions', () => {
  it('success case - replaces exactly the flagged line', () => {
    expect(applySuggestion('a\nb\nc', 2, 'B')).toBe('a\nB\nc')
  })

  it('success case - a multi-line suggestion expands in place', () => {
    expect(applySuggestion('a\nb\nc', 2, 'x\ny')).toBe('a\nx\ny\nc')
  })

  it('failure case - an out-of-range line is refused', () => {
    // The file moved since the review; writing anyway would corrupt an
    // unrelated line.
    expect(applySuggestion('a\nb', 5, 'x')).toBeNull()
    expect(applySuggestion('a\nb', 0, 'x')).toBeNull()
  })
})

describe('failure thresholds', () => {
  it('success case - a finding at the threshold fails', () => {
    expect(shouldFail([finding({ severity: 'major' })], 'major')).toBe(true)
  })

  it('success case - a finding above the threshold fails', () => {
    expect(shouldFail([finding({ severity: 'critical' })], 'major')).toBe(true)
  })

  it('failure case - findings below the threshold pass', () => {
    expect(shouldFail([finding({ severity: 'minor' }), finding({ severity: 'nit' })], 'major')).toBe(false)
  })

  it('edge case - no findings never fails', () => {
    expect(shouldFail([], 'nit')).toBe(false)
  })
})

describe('severity counting', () => {
  it('success case - counts each severity present', () => {
    const counts = countBySeverity([
      finding({ severity: 'major' }),
      finding({ severity: 'major' }),
      finding({ severity: 'nit' }),
    ])

    expect(counts).toEqual({ major: 2, nit: 1 })
  })
})
