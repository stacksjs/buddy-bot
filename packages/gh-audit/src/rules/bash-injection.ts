import type { Finding, Rule } from '../types'
import { findLine } from '../parser'
import { walkSteps } from './walk'

/**
 * `${{ ... }}` interpolation inside a `run:` block is evaluated by the
 * runner *before* the shell sees it — the resulting string becomes part
 * of the command line. When the source is attacker-controlled (PR title,
 * branch name, issue body, …), this is shell injection by design.
 *
 * Allowlist of known-safe contexts: anything from `secrets.*`, `vars.*`,
 * `runner.*`, `env.*` (the env was set by the workflow, not the
 * attacker), `github.repository`, `github.workflow`, `github.run_id`,
 * `github.run_number`, `github.event_name`, `github.actor` (still risky
 * but commonly accepted), `github.sha` (commit SHA, hex only).
 *
 * Anything else triggers a finding. We're deliberately noisy here — the
 * cost of a false positive is low (move the value into `env:` and
 * reference it as `"$VAR"`), the cost of a miss is RCE.
 */
export const bashInjection: Rule = {
  id: 'bash-injection',
  defaultSeverity: 'error',
  description: 'Avoid `${{ }}` interpolation of untrusted input inside `run:` blocks.',
  check(wf): Finding[] {
    const findings: Finding[] = []
    for (const { jobId, step, stepIndex } of walkSteps(wf)) {
      const run = typeof step.run === 'string' ? step.run : null
      if (!run)
        continue

      const matches = [...run.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)]
      for (const m of matches) {
        const expr = m[1].trim()
        if (isSafeExpression(expr))
          continue

        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          message: `Job \`${jobId}\`, step ${stepIndex + 1}: \`${expr}\` is interpolated into a shell.`,
          detail: 'GitHub evaluates `${{ ... }}` before the shell runs, so attacker-controlled values become part of the command line. Move the value into `env:` and reference it as a shell variable.',
          file: wf.file,
          line: findLine(wf.raw, m[0]),
          fix: 'Put the value in `env:` and reference it with `"$NAME"` instead.',
        })
      }
    }
    return findings
  },
}

const SAFE_PREFIXES = [
  'secrets.',
  'vars.',
  'runner.',
  'env.',
  'inputs.', // Workflow-call/dispatch inputs are configured by the caller
  'matrix.',
  'strategy.',
  'job.',
  'steps.',
  'needs.',
]

const SAFE_GITHUB_FIELDS = new Set([
  'github.repository',
  'github.repository_owner',
  'github.workflow',
  'github.run_id',
  'github.run_number',
  'github.run_attempt',
  'github.event_name',
  'github.sha',
  'github.ref_name', // Author-controllable but the runner sanitises slashes; leave a finding only when in a riskier context
  'github.token',
  'github.actor', // Author-controllable; intentionally accepted with a known caveat
  'github.actor_id',
  'github.api_url',
  'github.server_url',
  'github.graphql_url',
  'github.workspace',
  'github.action',
  'github.action_path',
  'github.action_ref',
  'github.action_repository',
  'github.action_status',
  'github.job',
  'github.job_workflow_sha',
])

function isSafeExpression(expr: string): boolean {
  if (SAFE_GITHUB_FIELDS.has(expr))
    return true
  return SAFE_PREFIXES.some(p => expr.startsWith(p))
}
