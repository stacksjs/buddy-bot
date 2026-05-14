import type { Finding, Rule } from '../types'
import { findLine } from '../parser'
import { walkJobs } from './walk'

/**
 * `runs-on: self-hosted` without an additional label restriction lets any
 * job in the repo (and, on a public repo, any PR) land on a self-hosted
 * runner. That runner persists state between jobs by default — a single
 * malicious checkout can implant tools that affect every subsequent job.
 *
 * The advice from GitHub's own hardening guide: never use bare
 * `self-hosted` on a public repo, and always combine it with at least one
 * scoping label (project name, environment, etc.) so the matching pool
 * is explicit.
 */
export const selfHostedExposure: Rule = {
  id: 'self-hosted-exposure',
  defaultSeverity: 'warning',
  description: 'Self-hosted runners should be scoped with additional labels, not used bare.',
  check(wf): Finding[] {
    const findings: Finding[] = []
    for (const { jobId, job } of walkJobs(wf)) {
      const runsOn = job['runs-on']
      if (!runsOn)
        continue

      if (typeof runsOn === 'string') {
        if (runsOn === 'self-hosted') {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            message: `Job \`${jobId}\` uses bare \`runs-on: self-hosted\`.`,
            file: wf.file,
            line: findLine(wf.raw, `runs-on: self-hosted`),
            fix: 'Add at least one scoping label, e.g. `runs-on: [self-hosted, my-project]`, and disable persistence on the runner.',
          })
        }
        continue
      }

      if (Array.isArray(runsOn)) {
        const labels = runsOn.filter((l): l is string => typeof l === 'string')
        if (labels.includes('self-hosted') && labels.length === 1) {
          findings.push({
            ruleId: this.id,
            severity: this.defaultSeverity,
            message: `Job \`${jobId}\` uses \`runs-on: [self-hosted]\` with no additional labels.`,
            file: wf.file,
            line: findLine(wf.raw, 'self-hosted'),
            fix: 'Add at least one scoping label (project name, environment) so the pool is explicit.',
          })
        }
      }
    }
    return findings
  },
}
