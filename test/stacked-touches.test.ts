import type { AiClient, AiResponse } from '../src/ai/types'
import type { GitProvider } from '../src/git/provider'
import type { PullRequest } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectChangedFiles, runStackedTouch, stackedBranchName, verifyChanges } from '../src/agent/stacked'
import { FINISHING_TOUCHES } from '../src/agent/tasks'
import { InMemoryProvider } from './git/in-memory-provider'
import { Logger } from '../src/utils/logger'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'buddy-stack-'))
  await run(['git', 'init', '-q'], root)
  await run(['git', 'config', 'user.email', 'test@example.test'], root)
  await run(['git', 'config', 'user.name', 'Test'], root)
  await writeFile(join(root, 'seed.txt'), 'seed\n')
  await run(['git', 'add', '-A'], root)
  await run(['git', 'commit', '-qm', 'seed'], root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function run(command: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(command, { cwd, stdout: 'ignore', stderr: 'ignore' })
  await proc.exited
}

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    title: 'feat: add the thing',
    body: '',
    head: 'contributor/feature',
    base: 'main',
    state: 'open',
    url: 'https://git.test/pull/42',
    createdAt: new Date(),
    updatedAt: new Date(),
    author: 'contributor',
    reviewers: [],
    assignees: [],
    labels: [],
    draft: false,
    ...overrides,
  }
}

/** A client whose agent run does nothing but report a stop reason. */
function stubClient(stopReason: 'end' | 'refusal' = 'end'): AiClient {
  return {
    provider: 'anthropic',
    model: 'test',
    tokensUsed: 0,
    async complete(): Promise<AiResponse> {
      return {
        text: 'done',
        toolCalls: [],
        stopReason,
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'test',
      }
    },
  }
}

describe('changed-file detection', () => {
  it('success case - reports a modified file', async () => {
    await writeFile(join(root, 'seed.txt'), 'edited\n')

    expect(await detectChangedFiles(root)).toEqual(['seed.txt'])
  })

  it('success case - reports an untracked file the agent created', async () => {
    await writeFile(join(root, 'new.ts'), 'export const x = 1\n')

    expect(await detectChangedFiles(root)).toContain('new.ts')
  })

  it('failure case - never reports a deletion', async () => {
    // Removing a contributor's file is a far larger claim than editing it, and
    // a finishing touch has no business making it.
    await rm(join(root, 'seed.txt'))

    expect(await detectChangedFiles(root)).toEqual([])
  })

  it('edge case - a clean tree has no changes', async () => {
    expect(await detectChangedFiles(root)).toEqual([])
  })

  it('edge case - a non-repository yields nothing rather than throwing', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'buddy-nongit-'))
    try {
      expect(await detectChangedFiles(outside)).toEqual([])
    }
    finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('verification', () => {
  it('failure case - a repository with no test script declined, not failed', async () => {
    // Treating the two the same would downgrade every finishing touch in every
    // untested repository.
    await writeFile(join(root, 'package.json'), '{"name":"x"}')

    expect(await verifyChanges(root)).toEqual({ ran: false, passed: false, output: '' })
  })

  it('failure case - no package.json means nothing to run', async () => {
    expect((await verifyChanges(root)).ran).toBe(false)
  })

  it('success case - a passing command verifies', async () => {
    const result = await verifyChanges(root, ['true'])

    expect(result).toMatchObject({ ran: true, passed: true })
  })

  it('failure case - a failing command does not verify', async () => {
    const result = await verifyChanges(root, ['false'])

    expect(result).toMatchObject({ ran: true, passed: false })
  })

  it('success case - captures output for the comment', async () => {
    const result = await verifyChanges(root, ['sh', '-c', 'echo "1 test failed"; exit 1'])

    expect(result.output).toContain('1 test failed')
  })
})

describe('stacked branch naming', () => {
  it('success case - names the branch after the pull request it stacks on', () => {
    expect(stackedBranchName(pr(), 'docstrings')).toBe('contributor/feature/buddy-docstrings')
  })
})

describe('stacked delivery', () => {
  async function provider(): Promise<GitProvider> {
    const memory = new InMemoryProvider({ draftPullRequests: true })
    await memory.createBranch('contributor/feature', 'main')
    return memory
  }

  it('success case - nothing changed reports exactly that', async () => {
    const result = await runStackedTouch({
      provider: await provider(),
      pullRequest: pr(),
      touch: FINISHING_TOUCHES.docstrings,
      ai: stubClient(),
      workspace: root,
      logger: Logger.silent(),
    })

    expect(result.mode).toBe('none')
    expect(result.changedFiles).toEqual([])
  })

  it('success case - a verified change opens a stacked pull request', async () => {
    await writeFile(join(root, 'seed.txt'), 'edited by the agent\n')

    const memory = await provider()
    const result = await runStackedTouch({
      provider: memory,
      pullRequest: pr(),
      touch: FINISHING_TOUCHES.docstrings,
      ai: stubClient(),
      workspace: root,
      testCommand: ['true'],
      logger: Logger.silent(),
    })

    expect(result.mode).toBe('stacked-pr')
    expect(result.verified).toBe(true)
    // Targeting the contributor's branch, not the base: merging it adds the
    // change to their pull request rather than to main.
    expect(result.pullRequest?.base).toBe('contributor/feature')
    expect(result.pullRequest?.head).toBe('contributor/feature/buddy-docstrings')
  })

  it('failure case - failing tests degrade to suggestions, not a branch', async () => {
    // A stacked PR that does not build is worse than a comment, because it
    // looks finished.
    await writeFile(join(root, 'seed.txt'), 'edited\n')

    const result = await runStackedTouch({
      provider: await provider(),
      pullRequest: pr(),
      touch: FINISHING_TOUCHES.docstrings,
      ai: stubClient(),
      workspace: root,
      testCommand: ['false'],
      logger: Logger.silent(),
    })

    expect(result.mode).toBe('suggestions')
    expect(result.verified).toBe(false)
    expect(result.comment).toContain('starting point')
  })

  it('success case - an unverifiable repository still stacks, and says so', async () => {
    await writeFile(join(root, 'seed.txt'), 'edited\n')

    const result = await runStackedTouch({
      provider: await provider(),
      pullRequest: pr(),
      touch: FINISHING_TOUCHES.docstrings,
      ai: stubClient(),
      workspace: root,
      logger: Logger.silent(),
    })

    expect(result.mode).toBe('stacked-pr')
    expect(result.comment).toContain('unverified')
  })

  it('failure case - a suggestion-only touch never opens a branch', async () => {
    // `plan` produces a plan, not an implementation.
    await writeFile(join(root, 'seed.txt'), 'edited\n')

    const result = await runStackedTouch({
      provider: await provider(),
      pullRequest: pr(),
      touch: FINISHING_TOUCHES.plan,
      ai: stubClient(),
      workspace: root,
      testCommand: ['true'],
      logger: Logger.silent(),
    })

    expect(result.mode).toBe('suggestions')
  })

  it('failure case - a provider error falls back to suggestions', async () => {
    // The work is done; losing it because a branch could not be pushed would
    // waste it.
    await writeFile(join(root, 'seed.txt'), 'edited\n')

    const broken = await provider()
    broken.createBranch = async () => {
      throw new Error('protected branch')
    }

    const result = await runStackedTouch({
      provider: broken,
      pullRequest: pr(),
      touch: FINISHING_TOUCHES.docstrings,
      ai: stubClient(),
      workspace: root,
      testCommand: ['true'],
      logger: Logger.silent(),
    })

    expect(result.mode).toBe('suggestions')
    expect(result.changedFiles).toEqual(['seed.txt'])
  })

  it('success case - the stacked body explains what merging it does', async () => {
    await writeFile(join(root, 'seed.txt'), 'edited\n')

    const memory = await provider()
    const result = await runStackedTouch({
      provider: memory,
      pullRequest: pr(),
      touch: FINISHING_TOUCHES.docstrings,
      ai: stubClient(),
      workspace: root,
      testCommand: ['true'],
      logger: Logger.silent(),
    })

    expect(result.pullRequest?.body).toContain('targets `contributor/feature`')
    expect(result.pullRequest?.body).toContain('tests pass')
  })

  it('success case - the contributor branch is never written to directly', async () => {
    // The whole safety argument: agent-authored commits must not appear under
    // someone else's name on a branch they are responsible for.
    await writeFile(join(root, 'seed.txt'), 'edited\n')

    const memory = new InMemoryProvider()
    await memory.createBranch('contributor/feature', 'main')
    const before = await memory.getFileContent('seed.txt', 'contributor/feature')

    await runStackedTouch({
      provider: memory,
      pullRequest: pr(),
      touch: FINISHING_TOUCHES.docstrings,
      ai: stubClient(),
      workspace: root,
      testCommand: ['true'],
      logger: Logger.silent(),
    })

    expect(await memory.getFileContent('seed.txt', 'contributor/feature')).toBe(before)
  })
})
