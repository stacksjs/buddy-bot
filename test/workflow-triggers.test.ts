import { describe, expect, it } from 'bun:test'
import { generateUnifiedWorkflow } from '../src/setup'

interface Workflow {
  on: Record<string, { types?: string[] } | undefined>
  jobs: Record<string, { if?: string, needs?: string[], steps?: Array<Record<string, unknown>> }>
}

function parse(): Workflow {
  return Bun.YAML.parse(generateUnifiedWorkflow(true)) as Workflow
}

describe('generated workflow triggers', () => {
  it('success case - is valid YAML', () => {
    expect(() => parse()).not.toThrow()
  })

  it('failure case - never uses pull_request_target', () => {
    // pull_request_target runs with write permissions and secrets in scope
    // while checking out the pull request's code. Review runs analyzers over
    // that tree, so this trigger would hand a fork write access to the repo.
    const workflow = parse()

    expect('pull_request_target' in workflow.on).toBe(false)
  })

  it('success case - reviews on open, ready and push', () => {
    const types = parse().on.pull_request?.types ?? []

    expect(types).toContain('opened')
    expect(types).toContain('ready_for_review')
    expect(types).toContain('synchronize')
  })

  it('success case - keeps the rebase-checkbox trigger', () => {
    expect(parse().on.pull_request?.types).toContain('edited')
  })

  it('success case - listens for comments on issues and reviews', () => {
    const workflow = parse()

    expect(workflow.on.issue_comment?.types).toEqual(['created'])
    expect(workflow.on.pull_request_review_comment?.types).toEqual(['created'])
  })

  it('success case - listens for completed workflow runs', () => {
    expect(parse().on.workflow_run?.types).toEqual(['completed'])
  })
})

describe('generated workflow jobs', () => {
  it('success case - defines a job per gated output', () => {
    const jobs = parse().jobs

    for (const name of ['command', 'review', 'fix-ci', 'check', 'dependency-update', 'dashboard-update'])
      expect(jobs[name]).toBeDefined()
  })

  it('success case - every AI job is gated on its own output', () => {
    const jobs = parse().jobs

    expect(jobs.command.if).toContain('run_command')
    expect(jobs.review.if).toContain('run_review')
    expect(jobs['fix-ci'].if).toContain('run_fixci')
  })

  it('success case - the fix-ci job checks out the failing branch', () => {
    const checkout = parse().jobs['fix-ci'].steps?.find(step =>
      String(step.uses ?? '').startsWith('actions/checkout'),
    )

    expect(JSON.stringify(checkout)).toContain('workflow_run.head_branch')
  })

  it('success case - AI jobs receive provider keys from secrets', () => {
    const steps = JSON.stringify(parse().jobs.review.steps)

    expect(steps).toContain('ANTHROPIC_API_KEY')
    expect(steps).toContain('OPENAI_API_KEY')
  })

  it('success case - every job depends on determine-jobs', () => {
    const jobs = parse().jobs

    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'determine-jobs')
        continue
      expect(job.needs).toContain('determine-jobs')
    }
  })
})
