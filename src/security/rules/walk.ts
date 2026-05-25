import type { ParsedWorkflow, WorkflowJob, WorkflowStep } from '../types'

export interface WalkedStep {
  jobId: string
  job: WorkflowJob
  stepIndex: number
  step: WorkflowStep
}

/**
 * Iterate over every step in every job. Rules use this so they don't each
 * re-implement the nested-object walk.
 */
export function* walkSteps(wf: ParsedWorkflow): Generator<WalkedStep> {
  const jobs = wf.data.jobs
  if (!jobs || typeof jobs !== 'object')
    return

  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object')
      continue
    const steps = job.steps
    if (!Array.isArray(steps))
      continue

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (!step || typeof step !== 'object')
        continue
      yield { jobId, job, stepIndex: i, step }
    }
  }
}

export function* walkJobs(wf: ParsedWorkflow): Generator<{ jobId: string, job: WorkflowJob }> {
  const jobs = wf.data.jobs
  if (!jobs || typeof jobs !== 'object')
    return
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object')
      continue
    yield { jobId, job }
  }
}
