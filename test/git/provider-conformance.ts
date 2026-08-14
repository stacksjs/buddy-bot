import type { GitProvider, ProviderCapabilities } from '../../src/git/provider'
import { describe, expect, it } from 'bun:test'

/**
 * Behavioural contract every {@link GitProvider} must satisfy.
 *
 * This exists so implementing GitLab (#115) or Bitbucket (#116) is "make the
 * suite pass" rather than archaeology across the GitHub provider. Run it
 * against a factory that returns a *fresh* provider each call — several checks
 * mutate state and would otherwise leak into each other.
 *
 * The suite deliberately tests contracts rather than transport: it never
 * asserts a URL shape or a status code, only what a caller in `buddy.ts` is
 * entitled to assume. A provider that talks to a real API can pass it against
 * a recorded fixture; an in-memory fake can pass it directly.
 *
 * @param name - Provider name, used in the describe block
 * @param create - Returns a fresh provider seeded with `baseBranch`
 * @example
 * ```ts
 * runProviderConformance('in-memory', () => new InMemoryProvider())
 * ```
 */
export function runProviderConformance(name: string, create: () => GitProvider): void {
  describe(`${name} provider conformance`, () => {
    describe('capabilities', () => {
      it('success case - declares every capability flag', () => {
        const caps = create().capabilities()
        const required: Array<keyof ProviderCapabilities> = [
          'pinIssues',
          'checkRuns',
          'inlineReviewComments',
          'reviewSuggestions',
          'nativeAutoMerge',
          'commentReactions',
          'ciLogs',
          'teamReviewers',
          'draftPullRequests',
          'permissionLookup',
          'branchHousekeeping',
        ]

        for (const flag of required)
          expect(typeof caps[flag]).toBe('boolean')
      })

      it('success case - every declared capability has its method', () => {
        // A flag without its method is the failure mode this suite exists to
        // catch: callers gate on the flag, so the lie becomes a TypeError deep
        // inside a workflow run rather than a clear error here.
        const provider = create()
        const caps = provider.capabilities()
        const gated: Array<[keyof ProviderCapabilities, keyof GitProvider]> = [
          ['pinIssues', 'pinIssue'],
          ['checkRuns', 'createCheckRun'],
          ['inlineReviewComments', 'createReview'],
          ['nativeAutoMerge', 'enableAutoMerge'],
          ['commentReactions', 'reactToComment'],
          ['ciLogs', 'getWorkflowRunLogs'],
          ['permissionLookup', 'hasWriteAccess'],
          ['branchHousekeeping', 'cleanupStaleBranches'],
        ]

        for (const [flag, method] of gated) {
          if (caps[flag])
            expect(typeof provider[method]).toBe('function')
        }
      })
    })

    describe('branches', () => {
      it('failure case - reports a missing branch as absent', async () => {
        expect(await create().branchExists('nope/does-not-exist')).toBe(false)
      })

      it('success case - a created branch then exists', async () => {
        const provider = create()
        await provider.createBranch('buddy-bot/update-x', 'main')

        expect(await provider.branchExists('buddy-bot/update-x')).toBe(true)
      })

      it('success case - a deleted branch stops existing', async () => {
        const provider = create()
        await provider.createBranch('buddy-bot/update-x', 'main')
        await provider.deleteBranch('buddy-bot/update-x')

        expect(await provider.branchExists('buddy-bot/update-x')).toBe(false)
      })

      it('success case - committing files makes them readable at the branch', async () => {
        const provider = create()
        await provider.createBranch('buddy-bot/update-x', 'main')
        await provider.commitChanges(
          'buddy-bot/update-x',
          'chore(deps): bump x',
          [{ path: 'package.json', content: '{"name":"x"}', type: 'update' }],
          'main',
        )

        expect(await provider.getFileContent('package.json', 'buddy-bot/update-x')).toBe('{"name":"x"}')
      })

      it('edge case - reading a missing path returns null rather than throwing', async () => {
        // Callers read optional files (guidelines, learnings) speculatively;
        // a throw would turn "not configured" into a failed run.
        expect(await create().getFileContent('.buddy/guidelines.md', 'main')).toBeNull()
      })
    })

    describe('pull requests', () => {
      it('success case - a created pull request is returned fully populated', async () => {
        const provider = create()
        const pr = await provider.createPullRequest({
          title: 'chore(deps): bump x',
          body: 'body',
          head: 'buddy-bot/update-x',
          base: 'main',
        })

        expect(pr.number).toBeGreaterThan(0)
        expect(pr.title).toBe('chore(deps): bump x')
        expect(pr.head).toBe('buddy-bot/update-x')
        expect(pr.base).toBe('main')
        expect(pr.state).toBe('open')
        expect(pr.url).toContain(String(pr.number))
        expect(pr.createdAt).toBeInstanceOf(Date)
        expect(Array.isArray(pr.labels)).toBe(true)
        expect(Array.isArray(pr.reviewers)).toBe(true)
      })

      it('success case - lists open pull requests', async () => {
        const provider = create()
        await provider.createPullRequest({ title: 'a', body: '', head: 'h1', base: 'main' })
        await provider.createPullRequest({ title: 'b', body: '', head: 'h2', base: 'main' })

        expect(await provider.getPullRequests('open')).toHaveLength(2)
      })

      it('success case - state filtering excludes closed pull requests', async () => {
        const provider = create()
        const pr = await provider.createPullRequest({ title: 'a', body: '', head: 'h1', base: 'main' })
        await provider.closePullRequest(pr.number)

        expect(await provider.getPullRequests('open')).toHaveLength(0)
        expect(await provider.getPullRequests('closed')).toHaveLength(1)
        expect(await provider.getPullRequests('all')).toHaveLength(1)
      })

      it('success case - updating changes only the fields given', async () => {
        const provider = create()
        const pr = await provider.createPullRequest({ title: 'a', body: 'original', head: 'h1', base: 'main' })

        const updated = await provider.updatePullRequest(pr.number, { title: 'b' })

        expect(updated.title).toBe('b')
        expect(updated.body).toBe('original')
      })

      it('success case - a reopened pull request is open again', async () => {
        const provider = create()
        const pr = await provider.createPullRequest({ title: 'a', body: '', head: 'h1', base: 'main' })
        await provider.closePullRequest(pr.number)
        await provider.reopenPullRequest(pr.number)

        expect((await provider.getPullRequests('open'))[0]?.number).toBe(pr.number)
      })

      it('success case - a merged pull request reports merged, not closed', async () => {
        // The dashboard and auto-close logic branch on this distinction.
        const provider = create()
        const pr = await provider.createPullRequest({ title: 'a', body: '', head: 'h1', base: 'main' })
        await provider.mergePullRequest(pr.number, 'squash')

        const merged = (await provider.getPullRequests('all')).find(p => p.number === pr.number)
        expect(merged?.state).toBe('merged')
        expect(merged?.mergedAt).toBeInstanceOf(Date)
      })

      it('success case - exposes a head sha and a diff', async () => {
        const provider = create()
        const pr = await provider.createPullRequest({ title: 'a', body: '', head: 'h1', base: 'main' })

        expect(await provider.getPullRequestHeadSha(pr.number)).toBeTruthy()
        expect(typeof await provider.getPullRequestDiff(pr.number)).toBe('string')
      })

      it('success case - draft state round-trips when supported', async () => {
        const provider = create()
        if (!provider.capabilities().draftPullRequests)
          return

        const pr = await provider.createPullRequest({ title: 'a', body: '', head: 'h1', base: 'main', draft: true })

        expect(pr.draft).toBe(true)
      })
    })

    describe('issues', () => {
      it('success case - a created issue is returned fully populated', async () => {
        const issue = await create().createIssue({ title: 'Dependency Dashboard', body: 'body' })

        expect(issue.number).toBeGreaterThan(0)
        expect(issue.state).toBe('open')
        expect(issue.title).toBe('Dependency Dashboard')
        expect(issue.createdAt).toBeInstanceOf(Date)
      })

      it('success case - updating changes only the fields given', async () => {
        const provider = create()
        const issue = await provider.createIssue({ title: 'a', body: 'original', labels: ['dependencies'] })

        const updated = await provider.updateIssue(issue.number, { body: 'new' })

        expect(updated.body).toBe('new')
        expect(updated.title).toBe('a')
        expect(updated.labels).toEqual(['dependencies'])
      })

      it('success case - state filtering excludes closed issues', async () => {
        const provider = create()
        const issue = await provider.createIssue({ title: 'a', body: '' })
        await provider.closeIssue(issue.number)

        expect(await provider.getIssues('open')).toHaveLength(0)
        expect(await provider.getIssues('closed')).toHaveLength(1)
      })

      it('success case - unpinning is safe to call unconditionally', async () => {
        // Cleanup calls this without checking capabilities, so it must resolve
        // rather than throw on a platform with no pinning at all.
        const provider = create()
        const issue = await provider.createIssue({ title: 'a', body: '' })

        expect(typeof await provider.unpinIssue(issue.number)).toBe('boolean')
      })

      it('success case - pinning round-trips when supported', async () => {
        const provider = create()
        if (!provider.capabilities().pinIssues)
          return

        const issue = await provider.createIssue({ title: 'a', body: '' })
        expect(await provider.pinIssue!(issue.number)).toBe(true)
        expect(await provider.unpinIssue(issue.number)).toBe(true)
      })
    })

    describe('comments', () => {
      it('success case - commenting on a pull request resolves', async () => {
        const provider = create()
        const pr = await provider.createPullRequest({ title: 'a', body: '', head: 'h1', base: 'main' })

        await expect(provider.createComment(pr.number, 'hello')).resolves.toBeUndefined()
      })
    })

    describe('error contracts', () => {
      it('failure case - acting on a missing pull request rejects', async () => {
        // Silently succeeding here would let a rebase run report success
        // against a PR somebody closed mid-run.
        await expect(create().updatePullRequest(4242, { title: 'x' })).rejects.toThrow()
      })

      it('failure case - acting on a missing issue rejects', async () => {
        await expect(create().updateIssue(4242, { body: 'x' })).rejects.toThrow()
      })
    })
  })
}
