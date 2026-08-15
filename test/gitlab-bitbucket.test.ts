import type { GitProvider } from '../src/git/provider'
import type { FakeRepo } from './git/fake-api'
import { afterEach, describe, expect, it } from 'bun:test'
import { BitbucketProvider } from '../src/git/bitbucket-provider'
import { GitLabProvider } from '../src/git/gitlab-provider'
import {
  ciTemplateFor,
  generateBitbucketPipeline,
  generateGitLabPipeline,
} from '../src/templates/gitlab-ci'
import { parseRemote } from '../src/setup'
import { REPOSITORY_ENV_VARS, resolveRepositoryConfig } from '../src/utils/repository'
import { Logger } from '../src/utils/logger'
import { bitbucketApi, createRepo, gitlabApi } from './git/fake-api'
import { runProviderConformance } from './git/provider-conformance'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/**
 * Both providers run through the conformance suite against a fake API rather
 * than a hand-written stub, so the actual HTTP mapping is what gets tested —
 * URL shapes, field names, state vocabularies. That translation layer is the
 * half most likely to be wrong.
 *
 * `globalThis.fetch` is set inside the factory because the suite creates a
 * fresh provider per test and each needs its own isolated repository.
 */
runProviderConformance('gitlab', () => {
  const repo = createRepo()
  globalThis.fetch = gitlabApi(repo)
  return new GitLabProvider('token', 'group/sub', 'repo', 'https://gitlab.test/api/v4', Logger.silent())
})

runProviderConformance('bitbucket', () => {
  const repo = createRepo()
  globalThis.fetch = bitbucketApi(repo)
  return new BitbucketProvider('token', 'workspace', 'repo', 'https://api.bitbucket.test/2.0', Logger.silent())
})

/** A GitLab provider over a fresh repository. */
function gitlab(): { provider: GitLabProvider, repo: FakeRepo } {
  const repo = createRepo()
  globalThis.fetch = gitlabApi(repo)
  return {
    provider: new GitLabProvider('token', 'group/sub', 'repo', 'https://gitlab.test/api/v4', Logger.silent()),
    repo,
  }
}

/** A Bitbucket provider over a fresh repository. */
function bitbucket(): { provider: BitbucketProvider, repo: FakeRepo } {
  const repo = createRepo()
  globalThis.fetch = bitbucketApi(repo)
  return {
    provider: new BitbucketProvider('token', 'workspace', 'repo', 'https://api.bitbucket.test/2.0', Logger.silent()),
    repo,
  }
}

describe('gitlab specifics', () => {
  it('success case - encodes a nested group path as one segment', async () => {
    // `group/subgroup/repo` has slashes that are part of the project *name*,
    // not the URL structure. Joining them into the path addresses nothing.
    let seen = ''
    globalThis.fetch = (async (input: string) => {
      seen = String(input)
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const provider = new GitLabProvider('t', 'group/sub', 'repo', 'https://gitlab.test/api/v4', Logger.silent())
    await provider.branchExists('x')

    expect(seen).toContain('group%2Fsub%2Frepo')
  })

  it('success case - a draft is marked by a title prefix', async () => {
    const { provider } = gitlab()
    const pr = await provider.createPullRequest({
      title: 'add the thing',
      body: '',
      head: 'feature',
      base: 'main',
      draft: true,
    })

    expect(pr.draft).toBe(true)
    // The prefix is GitLab's marker, not part of the title a caller set —
    // returning it would make an update round-trip grow `Draft: Draft:`.
    expect(pr.title).toBe('add the thing')
  })

  it('success case - a draft title survives a round-trip unchanged', async () => {
    const { provider } = gitlab()
    const pr = await provider.createPullRequest({
      title: 'add the thing',
      body: '',
      head: 'feature',
      base: 'main',
      draft: true,
    })

    const updated = await provider.updatePullRequest(pr.number, { body: 'new body' })

    expect(updated.title).toBe('add the thing')
  })

  it('success case - merged is distinct from closed', async () => {
    const { provider } = gitlab()
    await provider.createBranch('feature', 'main')
    const pr = await provider.createPullRequest({ title: 'a', body: '', head: 'feature', base: 'main' })
    await provider.mergePullRequest(pr.number)

    const merged = (await provider.getPullRequests('all')).find(entry => entry.number === pr.number)
    expect(merged?.state).toBe('merged')
  })

  it('success case - commit resolves create versus update against the base', async () => {
    // GitLab rejects the whole commit if one action has the wrong verb, so it
    // cannot be assumed from the caller's `type`.
    const { provider, repo } = gitlab()
    repo.branches.get('main')!.set('existing.txt', 'old')

    await provider.commitChanges('feature', 'msg', [
      { path: 'existing.txt', content: 'new', type: 'update' },
      { path: 'fresh.txt', content: 'hello', type: 'create' },
    ], 'main')

    expect(await provider.getFileContent('existing.txt', 'feature')).toBe('new')
    expect(await provider.getFileContent('fresh.txt', 'feature')).toBe('hello')
  })

  it('success case - recommitting resets rather than stacking', async () => {
    const { provider } = gitlab()

    await provider.commitChanges('feature', 'first', [{ path: 'a.txt', content: '1', type: 'create' }], 'main')
    await provider.commitChanges('feature', 'second', [{ path: 'b.txt', content: '2', type: 'create' }], 'main')

    // A re-run produces the same tree as a first run, not the union.
    expect(await provider.getFileContent('a.txt', 'feature')).toBeNull()
    expect(await provider.getFileContent('b.txt', 'feature')).toBe('2')
  })

  it('success case - declines issue pinning rather than pretending', async () => {
    const { provider } = gitlab()

    expect(provider.capabilities().pinIssues).toBe(false)
    // Safe to call unconditionally during cleanup.
    expect(await provider.unpinIssue(1)).toBe(false)
  })
})

describe('bitbucket specifics', () => {
  it('failure case - reopening says so rather than silently doing nothing', async () => {
    // A silent no-op leaves a caller believing the pull request is open again
    // when it is permanently declined.
    const { provider } = bitbucket()
    await provider.createBranch('feature', 'main')
    const pr = await provider.createPullRequest({ title: 'a', body: '', head: 'feature', base: 'main' })
    await provider.closePullRequest(pr.number)

    await expect(provider.reopenPullRequest(pr.number)).rejects.toThrow(/cannot reopen/i)
  })

  it('success case - a draft request opens as ready rather than faking one', async () => {
    // A "[Draft]" title prefix nothing understands is worse than an honest
    // absence.
    const { provider } = bitbucket()
    const pr = await provider.createPullRequest({
      title: 'add the thing',
      body: '',
      head: 'feature',
      base: 'main',
      draft: true,
    })

    expect(pr.draft).toBe(false)
    expect(pr.title).toBe('add the thing')
  })

  it('success case - declined and merged are both closed, but distinct', async () => {
    const { provider } = bitbucket()
    const declined = await provider.createPullRequest({ title: 'a', body: '', head: 'h1', base: 'main' })
    const merged = await provider.createPullRequest({ title: 'b', body: '', head: 'h2', base: 'main' })

    await provider.closePullRequest(declined.number)
    await provider.mergePullRequest(merged.number)

    const all = await provider.getPullRequests('all')
    expect(all.find(pr => pr.number === declined.number)?.state).toBe('closed')
    expect(all.find(pr => pr.number === merged.number)?.state).toBe('merged')
  })

  it('success case - commits create the branch implicitly', async () => {
    // Bitbucket's `/src` endpoint takes a parent commit, so there is no window
    // in which a branch exists with nothing on it.
    const { provider } = bitbucket()

    await provider.commitChanges('feature', 'msg', [
      { path: 'a.txt', content: 'hello', type: 'create' },
    ], 'main')

    expect(await provider.branchExists('feature')).toBe(true)
    expect(await provider.getFileContent('a.txt', 'feature')).toBe('hello')
  })

  it('success case - deletions are sent as repeated files parameters', async () => {
    const { provider, repo } = bitbucket()
    repo.branches.get('main')!.set('gone.txt', 'x')

    await provider.commitChanges('feature', 'msg', [
      { path: 'gone.txt', content: '', type: 'delete' },
      { path: 'kept.txt', content: 'y', type: 'create' },
    ], 'main')

    expect(await provider.getFileContent('gone.txt', 'feature')).toBeNull()
    expect(await provider.getFileContent('kept.txt', 'feature')).toBe('y')
  })

  it('success case - declines every capability it lacks', () => {
    const caps = bitbucket().provider.capabilities()

    expect(caps.nativeAutoMerge).toBe(false)
    expect(caps.draftPullRequests).toBe(false)
    expect(caps.commentReactions).toBe(false)
    expect(caps.ciLogs).toBe(false)
    expect(caps.pinIssues).toBe(false)
    expect(caps.reopenPullRequests).toBe(false)
    expect(caps.reviewSuggestions).toBe(false)
  })

  it('success case - the methods it lacks are absent, not stubs', () => {
    // A method present but inert is worse than one absent: `supports()` checks
    // both the flag and the method, so a stub would report the capability as
    // usable. Typed as the interface, which is how callers see it.
    const provider: GitProvider = bitbucket().provider

    expect(provider.enableAutoMerge).toBeUndefined()
    expect(provider.reactToComment).toBeUndefined()
    expect(provider.getWorkflowRunLogs).toBeUndefined()
    expect(provider.pinIssue).toBeUndefined()
  })
})

describe('cross-provider behaviour', () => {
  it('success case - both report the same shape for a pull request', async () => {
    // The whole point of the abstraction: a caller cannot tell them apart.
    const gl = gitlab()
    await gl.provider.createBranch('feature', 'main')
    const fromGitlab = await gl.provider.createPullRequest({
      title: 'a',
      body: 'b',
      head: 'feature',
      base: 'main',
    })

    const bb = bitbucket()
    const fromBitbucket = await bb.provider.createPullRequest({
      title: 'a',
      body: 'b',
      head: 'feature',
      base: 'main',
    })

    for (const pr of [fromGitlab, fromBitbucket]) {
      expect(pr).toMatchObject({ title: 'a', body: 'b', head: 'feature', base: 'main', state: 'open' })
      expect(pr.createdAt).toBeInstanceOf(Date)
      expect(Array.isArray(pr.labels)).toBe(true)
      expect(typeof pr.draft).toBe('boolean')
    }
  })

  it('success case - both surface a missing file as null', async () => {
    // Callers read optional files speculatively; a throw would turn "not
    // configured" into a failed run.
    expect(await gitlab().provider.getFileContent('.buddy/guidelines.md', 'main')).toBeNull()
    expect(await bitbucket().provider.getFileContent('.buddy/guidelines.md', 'main')).toBeNull()
  })
})

describe('CI templates', () => {
  it('success case - GitLab jobs gate on the schedule variable', () => {
    // GitLab schedules live in the UI and surface as a variable, so a file
    // that assumed a `schedule:` block would never run and give no clue why.
    const yaml = generateGitLabPipeline()

    expect(yaml).toContain('$BUDDY_JOB == "update"')
    expect(yaml).toContain('$BUDDY_JOB == "dashboard"')
    expect(yaml).toContain('Pipeline schedules')
  })

  it('success case - GitLab says which token is needed and why', () => {
    // CI_JOB_TOKEN cannot open merge requests, which is the failure a user
    // would otherwise hit on their first scheduled run.
    expect(generateGitLabPipeline()).toContain('CI_JOB_TOKEN cannot open merge requests')
  })

  it('success case - the review job is opt-in', () => {
    expect(generateGitLabPipeline()).not.toContain('buddy:review')
    expect(generateGitLabPipeline({ review: true })).toContain('buddy:review')
  })

  it('success case - GitLab reacts to merge request events', () => {
    expect(generateGitLabPipeline()).toContain('merge_request_event')
  })

  it('success case - Bitbucket exposes custom pipelines for schedules to target', () => {
    const yaml = generateBitbucketPipeline()

    expect(yaml).toContain('buddy-update:')
    expect(yaml).toContain('buddy-dashboard:')
    expect(yaml).toContain('pull-requests:')
  })

  it('success case - both templates parse as YAML', () => {
    // A template that does not parse is one nobody finds out about until CI
    // rejects it.
    expect(() => Bun.YAML.parse(generateGitLabPipeline({ review: true }))).not.toThrow()
    expect(() => Bun.YAML.parse(generateBitbucketPipeline())).not.toThrow()
  })

  it('success case - resolves a template per provider', () => {
    expect(ciTemplateFor('gitlab')?.path).toBe('.gitlab-ci.yml')
    expect(ciTemplateFor('bitbucket')?.path).toBe('bitbucket-pipelines.yml')
    // GitHub has the richer generator in setup.ts.
    expect(ciTemplateFor('github')).toBeNull()
  })
})

describe('remote detection', () => {
  it('success case - recognises each platform, HTTPS and SSH', () => {
    expect(parseRemote('https://github.com/stacksjs/buddy-bot.git'))
      .toEqual({ owner: 'stacksjs', name: 'buddy-bot', provider: 'github' })
    expect(parseRemote('git@gitlab.com:group/repo.git'))
      .toEqual({ owner: 'group', name: 'repo', provider: 'gitlab' })
    expect(parseRemote('https://bitbucket.org/workspace/repo'))
      .toEqual({ owner: 'workspace', name: 'repo', provider: 'bitbucket' })
  })

  it('success case - keeps a GitLab subgroup path intact', () => {
    // Truncating it would configure a project that does not exist.
    expect(parseRemote('git@gitlab.com:group/sub/deeper/repo.git'))
      .toEqual({ owner: 'group/sub/deeper', name: 'repo', provider: 'gitlab' })
  })

  it('failure case - an unknown host is not guessed at', () => {
    expect(parseRemote('git@git.acme.com:team/repo.git')).toBeNull()
    expect(parseRemote('')).toBeNull()
  })
})

describe('repository detection across CI platforms', () => {
  function resolve(env: Record<string, string | undefined>) {
    const config = { repository: { provider: 'github' as const, owner: '', name: '' } }
    return { result: resolveRepositoryConfig(config, env), config }
  }

  it('success case - reads GitHub Actions', () => {
    expect(resolve({ GITHUB_REPOSITORY: 'stacksjs/buddy-bot' }).result)
      .toMatchObject({ owner: 'stacksjs', name: 'buddy-bot' })
  })

  it('success case - reads GitLab CI', () => {
    // Without this, buddy-bot on GitLab CI with no config file cannot find
    // the repository it is running in at all.
    expect(resolve({ CI_PROJECT_PATH: 'group/repo' }).result)
      .toMatchObject({ owner: 'group', name: 'repo' })
  })

  it('success case - keeps a GitLab subgroup path in the owner', () => {
    // Truncating it would target a project that does not exist.
    expect(resolve({ CI_PROJECT_PATH: 'group/sub/deeper/repo' }).result)
      .toMatchObject({ owner: 'group/sub/deeper', name: 'repo' })
  })

  it('success case - reads Bitbucket Pipelines', () => {
    expect(resolve({ BITBUCKET_REPO_FULL_NAME: 'workspace/repo' }).result)
      .toMatchObject({ owner: 'workspace', name: 'repo' })
  })

  it('success case - resolves deterministically when several are set', () => {
    // A GitLab job mirroring from GitHub sets both; order decides, not chance.
    expect(resolve({ GITHUB_REPOSITORY: 'a/b', CI_PROJECT_PATH: 'c/d' }).result)
      .toMatchObject({ owner: 'a', name: 'b' })
    expect(REPOSITORY_ENV_VARS[0]).toBe('GITHUB_REPOSITORY')
  })

  it('edge case - a malformed value is ignored rather than half-parsed', () => {
    expect(resolve({ CI_PROJECT_PATH: 'norepo' }).result.source).toBe('unresolved')
    expect(resolve({ CI_PROJECT_PATH: '' }).result.source).toBe('unresolved')
  })
})

describe('setup generates the right CI file', () => {
  it('success case - a GitLab repository gets a GitLab pipeline', () => {
    // Writing GitHub Actions workflows into a GitLab repository produces files
    // that never run, which reads as a successful setup until the first
    // schedule does nothing.
    expect(ciTemplateFor('gitlab')?.path).toBe('.gitlab-ci.yml')
    expect(ciTemplateFor('bitbucket')?.path).toBe('bitbucket-pipelines.yml')
  })

  it('success case - the GitLab template declares no variable nothing reads', () => {
    // A setting in generated output that no code consults is worse than none:
    // it implies configuration that does nothing.
    expect(generateGitLabPipeline()).not.toContain('BUDDY_BOT_PROVIDER')
  })
})
