import type { Issue, IssueOptions } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { Buddy } from '../src/buddy'
import { GitHubApiError } from '../src/utils/errors'

function makeIssue(number: number): Issue {
  return {
    number,
    title: 'Dependency Dashboard',
    body: 'body',
    state: 'open',
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    author: 'buddy-bot',
    assignees: [],
    labels: ['dependencies', 'dashboard'],
  }
}

function makeBuddy() {
  return new Buddy({
    verbose: false,
    repository: { owner: 'theopenfarm', name: 'openfarm.ing', provider: 'github' },
  })
}

/** Reach the private helper without loosening its visibility in src. */
function updateDashboardIssue(buddy: Buddy, provider: unknown, number: number): Promise<Issue | null> {
  const options: IssueOptions = { title: 'Dependency Dashboard', body: 'body' }
  return (buddy as any).updateDashboardIssue(provider, number, options)
}

function apiError(status: number) {
  return new GitHubApiError(
    `GitHub API error: ${status}`,
    status,
    'PATCH',
    'https://api.github.com/repos/theopenfarm/openfarm.ing/issues/1911',
    'theopenfarm/openfarm.ing',
  )
}

describe('dashboard issue update', () => {
  it('success case - returns the updated issue', async () => {
    const provider = { updateIssue: async () => makeIssue(7) }
    const result = await updateDashboardIssue(makeBuddy(), provider, 7)

    expect(result?.number).toBe(7)
  })

  it('returns null when the issue is gone, so the caller can recreate it', async () => {
    // Regression: a dashboard number left over from another repository made the
    // whole dashboard job fail instead of creating a dashboard in this repo.
    const provider = {
      updateIssue: async () => {
        throw apiError(404)
      },
    }

    const result = await updateDashboardIssue(makeBuddy(), provider, 1911)
    expect(result).toBeNull()
  })

  it('treats 410 Gone as missing', async () => {
    const provider = {
      updateIssue: async () => {
        throw apiError(410)
      },
    }

    expect(await updateDashboardIssue(makeBuddy(), provider, 1911)).toBeNull()
  })

  it('failure case - rethrows a permission error rather than masking it', async () => {
    // Creating a replacement would hit the same 403, so silently continuing
    // would just hide a real misconfiguration.
    const provider = {
      updateIssue: async () => {
        throw apiError(403)
      },
    }

    await expect(updateDashboardIssue(makeBuddy(), provider, 1911)).rejects.toThrow('403')
  })

  it('failure case - rethrows non-API errors', async () => {
    const provider = {
      updateIssue: async () => {
        throw new Error('network down')
      },
    }

    await expect(updateDashboardIssue(makeBuddy(), provider, 1911)).rejects.toThrow('network down')
  })
})
