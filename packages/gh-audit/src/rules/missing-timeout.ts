import type { Finding, Rule } from '../types'
import { findLine } from '../parser'
import { walkJobs } from './walk'

/**
 * Jobs without `timeout-minutes` default to GitHub's 6-hour cap. A
 * compromised dependency that hangs (or a malicious script that mines
 * crypto) can burn six hours of compute before the runner is reaped. A
 * tighter explicit timeout limits the blast radius of resource-exhaustion
 * attacks and surfaces hung CI quickly.
 */
export const missingTimeout: Rule = {
  id: 'missing-timeout',
  defaultSeverity: 'warning',
  description: 'Jobs should declare an explicit `timeout-minutes` to bound runaway execution.',
  check(wf): Finding[] {
    const findings: Finding[] = []
    for (const { jobId, job } of walkJobs(wf)) {
      const timeout = job['timeout-minutes']
      if (typeof timeout === 'number' && timeout > 0)
        continue

      findings.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        message: `Job \`${jobId}\` has no \`timeout-minutes\`.`,
        file: wf.file,
        line: findLine(wf.raw, `${jobId}:`),
        fix: 'Add `timeout-minutes: <n>` (15–60 is a reasonable default for most CI jobs).',
      })
    }
    return findings
  },
}
