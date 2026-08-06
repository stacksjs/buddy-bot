import { describe, expect, it } from 'bun:test'

/**
 * Two regressions in the generated workflow that nothing failed on.
 *
 * Both were found by running actionlint over the generated YAML rather than by
 * a test, because neither produces an error at runtime: GitHub silently
 * resolves an undeclared input to nothing, and an injected branch name is
 * indistinguishable from a legitimate one until someone uses it.
 */
describe('generated workflow: declared inputs and untrusted values', () => {
  it('declares every workflow_dispatch input it reads', async () => {
    const { generateUnifiedWorkflow } = await import('../src/setup')
    const workflow = generateUnifiedWorkflow(true)

    // `pin` was read in three places and declared in none, so the
    // `|| 'true'` fallback always won and the toggle could not be set from
    // the Actions UI.
    const inputsBlock = workflow.slice(
      workflow.indexOf('workflow_dispatch:'),
      workflow.indexOf('env:'),
    )

    const read = [...workflow.matchAll(/github\.event\.inputs\.(\w+)/g)].map(m => m[1])
    expect(read.length).toBeGreaterThan(0)

    for (const name of new Set(read))
      expect(inputsBlock).toContain(`      ${name}:`)
  })

  it('passes the PR branch and actor through env, never into the script', async () => {
    const { generateUnifiedWorkflow } = await import('../src/setup')
    const workflow = generateUnifiedWorkflow(true)

    // A branch name is attacker-chosen text. Interpolated into a `run:` block
    // it executes — and this workflow carries BUDDY_BOT_TOKEN, a PAT with repo
    // and workflow scopes, which a same-repo PR does receive.
    expect(workflow).not.toContain('BRANCH="${{ github.event.pull_request.head.ref }}"')
    expect(workflow).not.toContain('ACTOR="${{ github.actor }}"')

    expect(workflow).toContain('PR_BRANCH: ${{ github.event.pull_request.head.ref }}')
    expect(workflow).toContain('PR_ACTOR: ${{ github.actor }}')
    expect(workflow).toContain('BRANCH="$PR_BRANCH"')
    expect(workflow).toContain('ACTOR="$PR_ACTOR"')
  })

  it('keeps schedules at or above the 5 minute floor GitHub enforces', async () => {
    const { generateUnifiedWorkflow } = await import('../src/setup')
    const workflow = generateUnifiedWorkflow(true)

    // A `*/1 * * * *` schedule is accepted and then quietly not honored, so a
    // job written to run every minute does not.
    for (const [, minute] of workflow.matchAll(/cron: '([^ ]+) /g)) {
      const step = minute.startsWith('*/') ? Number(minute.slice(2)) : null
      if (step !== null)
        expect(step).toBeGreaterThanOrEqual(5)
    }
  })
})
