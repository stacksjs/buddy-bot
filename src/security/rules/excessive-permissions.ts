import type { Finding, Rule, WorkflowPermissions } from '../types'
import { findLine } from '../parser'
import { walkJobs } from './walk'

/**
 * Flag two distinct hazards under the same rule because the fix shape is
 * the same:
 *
 * 1. `permissions: write-all` — grants every scope, defeating GitHub's
 *    least-privilege model. A compromised step can do anything the token
 *    can do.
 * 2. No top-level `permissions` block at all — the job inherits the
 *    repository default, which is `write-all` on most repos created
 *    before 2023. Explicit `permissions: contents: read` or similar is
 *    the safer default.
 */
export const excessivePermissions: Rule = {
  id: 'excessive-permissions',
  defaultSeverity: 'warning',
  description: 'Workflows and jobs should declare a least-privilege `permissions:` block.',
  check(wf): Finding[] {
    const findings: Finding[] = []
    const top = wf.data.permissions

    if (top === undefined) {
      findings.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        message: 'Workflow does not declare top-level `permissions:`.',
        detail: 'Without an explicit `permissions:` block, jobs inherit the repository default — historically `write-all`. Add a least-privilege block at the workflow root.',
        file: wf.file,
        line: 1,
        fix: 'Add `permissions:\\n  contents: read` at the top of the workflow, then narrow per-job as needed.',
      })
    }
    else if (top === 'write-all') {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: 'Workflow grants `permissions: write-all`.',
        file: wf.file,
        line: findLine(wf.raw, 'write-all'),
        fix: 'Replace with explicit per-scope grants (e.g. `contents: read`, `pull-requests: write`).',
      })
    }
    else if (top !== 'read-all' && typeof top === 'object') {
      findings.push(...flagDangerousScopes(this.id, wf.file, wf.raw, top, 'workflow'))
    }

    for (const { jobId, job } of walkJobs(wf)) {
      const perms = job.permissions
      if (perms === undefined)
        continue
      if (perms === 'write-all') {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `Job \`${jobId}\` grants \`permissions: write-all\`.`,
          file: wf.file,
          line: findLine(wf.raw, 'write-all'),
          fix: 'Replace with explicit per-scope grants.',
        })
      }
      else if (perms !== 'read-all' && typeof perms === 'object') {
        findings.push(...flagDangerousScopes(this.id, wf.file, wf.raw, perms, `job \`${jobId}\``))
      }
    }

    return findings
  },
}

function flagDangerousScopes(
  ruleId: string,
  file: string,
  raw: string,
  perms: Exclude<WorkflowPermissions, 'read-all' | 'write-all'>,
  context: string,
): Finding[] {
  // Plain map form. We don't have anything to flag yet beyond `write-all`
  // sneaking in via individual scopes — but the structure is here so we
  // can add (e.g.) "actions: write" warnings later without restructuring.
  const findings: Finding[] = []
  if (typeof perms !== 'object' || perms === null)
    return findings
  for (const [scope, value] of Object.entries(perms)) {
    if (value === 'write' && (scope === 'actions' || scope === 'id-token')) {
      findings.push({
        ruleId,
        severity: 'warning',
        message: `${context} grants \`${scope}: write\` — verify this is required.`,
        detail: scope === 'id-token'
          ? '`id-token: write` is needed for OIDC federation but should never be combined with running untrusted code.'
          : '`actions: write` allows the workflow to dispatch other workflows, increasing blast radius if compromised.',
        file,
        line: findLine(raw, `${scope}: write`),
      })
    }
  }
  return findings
}
