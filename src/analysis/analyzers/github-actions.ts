import type { ReviewFinding } from '../../review/findings'
import type { Severity } from '../../security/types'
import type { Analyzer } from '../types'
import { audit } from '../../security/engine'

/** Map the workflow auditor's severities onto review severities. */
function toReviewSeverity(severity: Severity): ReviewFinding['severity'] {
  switch (severity) {
    case 'error':
      return 'major'
    case 'warning':
      return 'minor'
    default:
      return 'nit'
  }
}

/**
 * The existing GitHub Actions workflow auditor, as an analyzer.
 *
 * Wrapping rather than reimplementing: the six workflow rules already exist
 * and are tested, and this exposes them through the same path as every other
 * analyzer so their findings land as review comments alongside the rest.
 */
export const githubActionsAnalyzer: Analyzer = {
  name: 'workflow-audit',
  filePatterns: ['.github/workflows/*.yml', '.github/workflows/*.yaml'],

  async available(): Promise<boolean> {
    // Native rules, no external binary to find.
    return true
  },

  async run(files: string[], root: string): Promise<ReviewFinding[]> {
    if (files.length === 0)
      return []

    const result = await audit(root)

    // The auditor scans every workflow in the repository; only report on the
    // ones this change actually touched.
    const changed = new Set(files)

    return result.findings
      .filter(finding => changed.has(finding.file))
      .map(finding => ({
        path: finding.file,
        line: finding.line ?? 1,
        severity: toReviewSeverity(finding.severity),
        category: finding.ruleId,
        message: finding.fix ? `${finding.message}\n\n${finding.fix}` : finding.message,
        tool: 'workflow-audit',
      }))
  },
}
