import { describe, expect, it } from 'bun:test'
import {
  hasDashboardActions,
  parseDashboardActions,
  uncheckDashboardActions,
} from '../src/dashboard/dashboard-actions'

/** A dashboard body in the exact shape the generator renders. */
function makeDashboard(options: {
  rebased?: string[]
  rebaseAll?: boolean
  manual?: boolean
} = {}): string {
  const rebased = options.rebased ?? []
  const box = (branch: string) => rebased.includes(branch) ? 'x' : ' '

  return `# Dependency Dashboard

## Open

 - [${box('buddy-bot/update-react')}] <!-- rebase-branch=buddy-bot/update-react -->[chore(deps): update react](../pull/123) (\`react\`)
 - [${box('buddy-bot/update-types')}] <!-- rebase-branch=buddy-bot/update-types -->[chore(deps): update types](../pull/124) (\`@types/node\`)
 - [${options.rebaseAll ? 'x' : ' '}] <!-- rebase-all-open-prs -->**Click on this checkbox to rebase all open PRs at once**

---

- [${options.manual ? 'x' : ' '}] <!-- manual job -->Check this box to trigger a request for Buddy Bot to run again on this repository
`
}

describe('dashboard actions', () => {
  describe('parseDashboardActions', () => {
    it('success case - reports nothing when no box is ticked', () => {
      const actions = parseDashboardActions(makeDashboard())

      expect(actions).toEqual({ rebaseBranches: [], rebaseAll: false, manualRun: false })
      expect(hasDashboardActions(actions)).toBe(false)
    })

    it('success case - reads a single ticked rebase box', () => {
      const actions = parseDashboardActions(makeDashboard({ rebased: ['buddy-bot/update-react'] }))

      expect(actions.rebaseBranches).toEqual(['buddy-bot/update-react'])
      expect(actions.rebaseAll).toBe(false)
      expect(hasDashboardActions(actions)).toBe(true)
    })

    it('success case - reads several ticked rebase boxes', () => {
      const actions = parseDashboardActions(
        makeDashboard({ rebased: ['buddy-bot/update-react', 'buddy-bot/update-types'] }),
      )

      expect(actions.rebaseBranches).toEqual(['buddy-bot/update-react', 'buddy-bot/update-types'])
    })

    it('success case - reads the rebase-all box', () => {
      expect(parseDashboardActions(makeDashboard({ rebaseAll: true })).rebaseAll).toBe(true)
    })

    it('success case - reads the manual run box', () => {
      expect(parseDashboardActions(makeDashboard({ manual: true })).manualRun).toBe(true)
    })

    it('edge case - accepts an uppercase X', () => {
      const body = ' - [X] <!-- rebase-branch=buddy-bot/update-react -->[title](../pull/1)'

      expect(parseDashboardActions(body).rebaseBranches).toEqual(['buddy-bot/update-react'])
    })

    it('edge case - handles null and empty bodies', () => {
      expect(parseDashboardActions(null).rebaseBranches).toEqual([])
      expect(parseDashboardActions('').manualRun).toBe(false)
    })

    it('edge case - deduplicates a branch listed twice', () => {
      const body = [
        ' - [x] <!-- rebase-branch=buddy-bot/update-react -->[a](../pull/1)',
        ' - [x] <!-- rebase-branch=buddy-bot/update-react -->[b](../pull/2)',
      ].join('\n')

      expect(parseDashboardActions(body).rebaseBranches).toEqual(['buddy-bot/update-react'])
    })

    it('failure case - ignores an unticked marker on a ticked-looking line', () => {
      const body = ' - [ ] <!-- rebase-branch=buddy-bot/update-react -->[x] not a checkbox'

      expect(parseDashboardActions(body).rebaseBranches).toEqual([])
    })
  })

  describe('uncheckDashboardActions', () => {
    it('success case - unticks every buddy-bot checkbox', () => {
      const ticked = makeDashboard({
        rebased: ['buddy-bot/update-react', 'buddy-bot/update-types'],
        rebaseAll: true,
        manual: true,
      })

      const cleared = uncheckDashboardActions(ticked)

      expect(hasDashboardActions(parseDashboardActions(cleared))).toBe(false)
      expect(cleared).toBe(makeDashboard())
    })

    it('edge case - leaves a maintainer\'s own checkbox alone', () => {
      const body = `${makeDashboard({ manual: true })}\n- [x] my own todo item`

      const cleared = uncheckDashboardActions(body)

      expect(cleared).toContain('- [x] my own todo item')
      expect(parseDashboardActions(cleared).manualRun).toBe(false)
    })

    it('edge case - unticking an already-clear body is a no-op', () => {
      const clean = makeDashboard()

      expect(uncheckDashboardActions(clean)).toBe(clean)
    })
  })
})
