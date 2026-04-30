import { describe, expect, it } from 'bun:test'
import { GitHubProvider } from '../src/git/github-provider'

/**
 * Regression: a previous implementation determined PR open/closed state by
 * scraping `https://github.com/{owner}/{repo}/pull/{n}` for `State--open` /
 * `State--closed` CSS classes. GitHub later removed those classes from the
 * rendered HTML, so every PR was misreported as "closed" — leading
 * cleanupStaleBranches to delete the branch of a freshly-opened PR, which in
 * turn auto-closed the PR. These tests lock in the fix: open-PR detection
 * uses the GitHub REST API, and an open PR's branch is never treated as
 * orphaned.
 */

interface MockPullsResponse {
  number: number
  title: string
  body: string | null
  state: string
  html_url: string
  created_at: string
  updated_at: string
  merged_at: string | null
  user: { login: string }
  head: { ref: string }
  base: { ref: string }
  draft?: boolean
  requested_reviewers?: Array<{ login: string }>
  assignees?: Array<{ login: string }>
  labels?: Array<{ name: string }>
}

function mockPR(number: number, headRef: string): MockPullsResponse {
  return {
    number,
    title: `chore(deps): #${number}`,
    body: '',
    state: 'open',
    html_url: `https://github.com/owner/repo/pull/${number}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    merged_at: null,
    user: { login: 'github-actions[bot]' },
    head: { ref: headRef },
    base: { ref: 'main' },
    draft: false,
    requested_reviewers: [],
    assignees: [],
    labels: [],
  }
}

function makeProvider(opts: {
  openPRHeadRefs: string[]
  buddyBotBranches: Array<{ name: string, daysOld: number }>
  apiThrows?: Error
}) {
  const prov = new GitHubProvider('token', 'owner', 'repo', true) as any

  // Stub the PR API
  prov.apiRequest = async (endpoint: string) => {
    if (endpoint.includes('/pulls?state=open')) {
      if (opts.apiThrows)
        throw opts.apiThrows
      return opts.openPRHeadRefs.map((ref, i) => mockPR(100 + i, ref))
    }
    return []
  }

  // Stub git branch listing
  prov.runCommand = async (command: string, args: string[]) => {
    if (command === 'git' && args[0] === 'branch' && args[1] === '-r') {
      return opts.buddyBotBranches
        .map((b) => {
          const date = new Date()
          date.setDate(date.getDate() - b.daysOld)
          return `origin/${b.name} ${'a'.repeat(40)} ${date.toISOString()}`
        })
        .join('\n')
    }
    // For deleteBranch via git push origin --delete
    if (command === 'git' && args[0] === 'push' && args.includes('--delete'))
      return ''
    return ''
  }

  // Bypass network deletion via API
  prov.apiRequestWithRetry = prov.apiRequest

  return prov
}

describe('Orphan branch detection (regression: PR-page scraping bug)', () => {
  it('protects the branch of an open PR returned by the GitHub API', async () => {
    const prov = makeProvider({
      openPRHeadRefs: ['buddy-bot/update-non-major-updates'],
      buddyBotBranches: [{ name: 'buddy-bot/update-non-major-updates', daysOld: 0 }],
    })

    const orphans = await prov.getOrphanedBuddyBotBranches()
    expect(orphans).toEqual([])
  })

  it('marks a buddy-bot branch with no associated open PR as orphaned', async () => {
    const prov = makeProvider({
      openPRHeadRefs: [],
      buddyBotBranches: [{ name: 'buddy-bot/update-non-major-updates', daysOld: 0 }],
    })

    const orphans = await prov.getOrphanedBuddyBotBranches()
    expect(orphans.map((b: any) => b.name)).toEqual(['buddy-bot/update-non-major-updates'])
  })

  it('protects only buddy-bot branches with matching head refs (mixed open PRs)', async () => {
    const prov = makeProvider({
      openPRHeadRefs: ['buddy-bot/update-react', 'feature/unrelated'],
      buddyBotBranches: [
        { name: 'buddy-bot/update-react', daysOld: 0 },
        { name: 'buddy-bot/update-typescript', daysOld: 0 },
      ],
    })

    const orphans = await prov.getOrphanedBuddyBotBranches()
    expect(orphans.map((b: any) => b.name)).toEqual(['buddy-bot/update-typescript'])
  })

  it('cleanupStaleBranches with API success deletes ALL orphans regardless of age', async () => {
    const prov = makeProvider({
      openPRHeadRefs: [],
      buddyBotBranches: [{ name: 'buddy-bot/update-react', daysOld: 0 }], // freshly created
    })
    const deleted: string[] = []
    prov.deleteBranch = async (name: string) => {
      deleted.push(name)
    }

    const result = await prov.cleanupStaleBranches(7, false)

    expect(deleted).toEqual(['buddy-bot/update-react'])
    expect(result.deleted).toEqual(['buddy-bot/update-react'])
  })

  it('cleanupStaleBranches with API failure spares branches younger than the age threshold', async () => {
    const prov = makeProvider({
      openPRHeadRefs: [],
      buddyBotBranches: [{ name: 'buddy-bot/update-react', daysOld: 0 }], // freshly created
      apiThrows: new Error('GitHub API unavailable'),
    })
    const deleted: string[] = []
    prov.deleteBranch = async (name: string) => {
      deleted.push(name)
    }

    const result = await prov.cleanupStaleBranches(7, false)

    expect(deleted).toEqual([])
    expect(result.deleted).toEqual([])
  })

  it('cleanupStaleBranches with API failure still deletes branches older than the age threshold', async () => {
    const prov = makeProvider({
      openPRHeadRefs: [],
      buddyBotBranches: [
        { name: 'buddy-bot/update-react', daysOld: 0 }, // young, must NOT be deleted
        { name: 'buddy-bot/very-old', daysOld: 60 }, // old, OK to delete
      ],
      apiThrows: new Error('GitHub API unavailable'),
    })
    const deleted: string[] = []
    prov.deleteBranch = async (name: string) => {
      deleted.push(name)
    }

    const result = await prov.cleanupStaleBranches(7, false)

    expect(deleted).toEqual(['buddy-bot/very-old'])
    expect(result.deleted).toEqual(['buddy-bot/very-old'])
  })
})
