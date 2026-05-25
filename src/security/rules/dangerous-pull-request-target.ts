import type { Finding, Rule } from '../types'
import { findLine } from '../parser'
import { walkSteps } from './walk'

/**
 * `pull_request_target` runs in the context of the *base* repo with full
 * write permissions and access to secrets — but combining it with a
 * `actions/checkout` of `${{ github.event.pull_request.head.sha }}` (or
 * any reference that resolves to PR-author-controlled code) lets a
 * malicious PR execute arbitrary code with those secrets. This is the
 * single most exploited misconfiguration in GitHub Actions.
 *
 * We flag any workflow that:
 *   1. Triggers on `pull_request_target`, AND
 *   2. Uses `actions/checkout` (any version) with a `with.ref` referencing
 *      the PR head, OR uses checkout without an explicit `ref:` (the
 *      default `ref` in `pull_request_target` is the base, which is safe
 *      — but most authors don't realise this and still trip the next rule
 *      below).
 */
export const dangerousPullRequestTarget: Rule = {
  id: 'dangerous-pull-request-target',
  defaultSeverity: 'error',
  description: 'Avoid checking out PR-author code from a `pull_request_target` workflow.',
  check(wf): Finding[] {
    if (!triggersOn(wf.data.on, 'pull_request_target'))
      return []

    const findings: Finding[] = []
    for (const { jobId, step } of walkSteps(wf)) {
      const uses = typeof step.uses === 'string' ? step.uses : ''
      if (!uses.startsWith('actions/checkout@'))
        continue

      const ref = typeof step.with?.ref === 'string' ? step.with.ref : null
      if (!ref)
        continue

      if (ref.includes('pull_request') || ref.includes('head.sha') || ref.includes('head.ref') || ref.includes('github.head_ref')) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          message: `Job \`${jobId}\` checks out PR-author code under \`pull_request_target\`.`,
          detail: 'This grants attacker-controlled code access to repository secrets and write tokens. Move the build to `pull_request` or run untrusted code in a sandboxed second workflow without secrets.',
          file: wf.file,
          line: findLine(wf.raw, ref),
          fix: 'Either switch the trigger to `pull_request`, or split into two workflows: one privileged (no checkout of head) and one unprivileged (checkout of head, no secrets).',
        })
      }
    }
    return findings
  },
}

function triggersOn(triggers: unknown, event: string): boolean {
  if (typeof triggers === 'string')
    return triggers === event
  if (Array.isArray(triggers))
    return triggers.includes(event)
  if (triggers && typeof triggers === 'object')
    return event in triggers
  return false
}
