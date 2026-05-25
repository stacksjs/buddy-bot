import type { AuditResult } from '../types'

export function formatJson(result: AuditResult): string {
  return JSON.stringify(
    {
      ok: !result.failed,
      summary: {
        workflows: result.workflows.length,
        findings: result.findings.length,
        errors: result.findings.filter(f => f.severity === 'error').length,
        warnings: result.findings.filter(f => f.severity === 'warning').length,
        info: result.findings.filter(f => f.severity === 'info').length,
      },
      findings: result.findings,
    },
    null,
    2,
  )
}
