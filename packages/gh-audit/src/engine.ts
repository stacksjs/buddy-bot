import type { AuditOptions, AuditResult, Finding, ParsedWorkflow } from './types'
import { loadWorkflows } from './loader'
import { rules as defaultRules } from './rules'

/**
 * Top-level entry point: discover workflows under `root` and run every
 * rule against each one. Failure is determined by the presence of any
 * `error`-severity finding so callers can `process.exit` on it.
 */
export async function audit(root: string, options: AuditOptions = {}): Promise<AuditResult> {
  const workflows = await loadWorkflows(root)
  return auditParsed(workflows, options)
}

/**
 * Run rules against an already-loaded set of workflows. Useful when the
 * caller (e.g. buddy-bot) has its own loader or supplies fixtures.
 */
export function auditParsed(workflows: ParsedWorkflow[], options: AuditOptions = {}): AuditResult {
  const rules = (options.rules ?? defaultRules).filter((r) => {
    return !options.ignore?.includes(r.id)
  })

  const findings: Finding[] = []

  for (const wf of workflows) {
    for (const rule of rules) {
      const out = rule.check(wf)
      for (const f of out)
        findings.push(f)
    }
  }

  const failed = findings.some(f => f.severity === 'error')
  return { workflows, findings, failed }
}
