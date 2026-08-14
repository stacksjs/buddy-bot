import type { GitProvider } from '../src/git/provider'
import { describe, expect, it } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GitHubProvider } from '../src/git/github-provider'
import {
  assertProviderSupported,
  assertSupports,
  createProvider,
  IMPLEMENTED_PROVIDERS,
  NO_CAPABILITIES,
  PROVIDER_NAMES,
  PROVIDER_TOKEN_ENV,
  resolveProviderToken,
  supports,
  UnsupportedProviderError,
} from '../src/git/provider'
import { validateConfig } from '../src/config-validation'
import { InMemoryProvider } from './git/in-memory-provider'
import { runProviderConformance } from './git/provider-conformance'

runProviderConformance('in-memory', () => new InMemoryProvider())
runProviderConformance('in-memory (full capabilities)', () => new InMemoryProvider({
  pinIssues: true,
  checkRuns: true,
  nativeAutoMerge: false,
}))

describe('provider registry', () => {
  it('success case - names every provider the type admits', () => {
    expect(PROVIDER_NAMES).toEqual(['github', 'gitlab', 'bitbucket'])
  })

  it('success case - only github is implemented today', () => {
    expect(IMPLEMENTED_PROVIDERS).toEqual(['github'])
  })

  it('success case - accepts an implemented provider', () => {
    expect(() => assertProviderSupported('github')).not.toThrow()
  })

  it('failure case - a planned provider names its tracking issue', () => {
    // Pointing at the thread is what stops a user filing a duplicate.
    expect(() => assertProviderSupported('gitlab')).toThrow(/issues\/115/)
    expect(() => assertProviderSupported('bitbucket')).toThrow(/issues\/116/)
  })

  it('failure case - an unknown provider lists what is supported', () => {
    try {
      assertProviderSupported('svn')
      throw new Error('expected a throw')
    }
    catch (error) {
      expect(error).toBeInstanceOf(UnsupportedProviderError)
      expect((error as UnsupportedProviderError).message).toContain('github')
      expect((error as UnsupportedProviderError).trackingIssue).toBeUndefined()
    }
  })

  it('success case - config validation rejects an unbuilt provider with its issue', () => {
    const issues = validateConfig({ repository: { provider: 'gitlab', owner: 'o', name: 'r' } })

    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('repository.provider')
    expect(issues[0].message).toContain('issues/115')
  })

  it('success case - config validation still accepts github', () => {
    expect(validateConfig({ repository: { provider: 'github', owner: 'o', name: 'r' } })).toEqual([])
  })
})

describe('token resolution', () => {
  it('success case - prefers the ambient CI token for attribution', () => {
    // The personal token is not a better GITHUB_TOKEN — it is the *workflow*
    // token, passed separately. Preferring it here would change who appears to
    // have opened every pull request.
    const resolved = resolveProviderToken('github', { BUDDY_BOT_TOKEN: 'pat', GITHUB_TOKEN: 'ambient' })

    expect(resolved).toEqual({ token: 'ambient', source: 'GITHUB_TOKEN' })
  })

  it('success case - falls back to the buddy-bot token when CI provides none', () => {
    expect(resolveProviderToken('github', { BUDDY_BOT_TOKEN: 'pat' })?.source).toBe('BUDDY_BOT_TOKEN')
  })

  it('success case - each provider has its own convention', () => {
    expect(PROVIDER_TOKEN_ENV.gitlab).toContain('GITLAB_TOKEN')
    expect(PROVIDER_TOKEN_ENV.bitbucket).toContain('BITBUCKET_TOKEN')
  })

  it('failure case - a blank token counts as absent', () => {
    expect(resolveProviderToken('github', { GITHUB_TOKEN: '   ' })).toBeNull()
  })

  it('edge case - no token at all resolves to null', () => {
    expect(resolveProviderToken('github', {})).toBeNull()
  })
})

describe('provider factory', () => {
  it('success case - builds a GitHub provider from config', async () => {
    const provider = await createProvider(
      { provider: 'github', owner: 'o', name: 'r' },
      { env: { GITHUB_TOKEN: 'token' } },
    )

    expect(provider).toBeInstanceOf(GitHubProvider)
    expect(provider.capabilities().checkRuns).toBe(true)
  })

  it('success case - defaults to github when unspecified', async () => {
    const provider = await createProvider({ owner: 'o', name: 'r', token: 'x' }, { env: {} })

    expect(provider).toBeInstanceOf(GitHubProvider)
  })

  it('failure case - refuses an unimplemented provider', async () => {
    await expect(createProvider({ provider: 'gitlab', owner: 'o', name: 'r', token: 'x' }))
      .rejects
      .toThrow(UnsupportedProviderError)
  })

  it('failure case - names the variables to set when no token is found', async () => {
    await expect(createProvider({ owner: 'o', name: 'r' }, { env: {} }))
      .rejects
      .toThrow(/GITHUB_TOKEN.*BUDDY_BOT_TOKEN/)
  })
})

describe('capability gating', () => {
  it('success case - a supported capability narrows the method to defined', () => {
    const provider = new InMemoryProvider({ pinIssues: true })

    expect(supports(provider, 'pinIssues', 'pinIssue')).toBe(true)
  })

  it('failure case - a false flag gates the method off', () => {
    expect(supports(new InMemoryProvider(), 'pinIssues', 'pinIssue')).toBe(false)
  })

  it('failure case - a flag claiming a method that is absent is not trusted', () => {
    // A provider bug must not become a TypeError at the call site.
    const liar = { capabilities: () => ({ ...NO_CAPABILITIES, ciLogs: true }) } as unknown as GitProvider

    expect(supports(liar, 'ciLogs', 'getWorkflowRunLogs')).toBe(false)
  })

  it('success case - asserting a present capability is a no-op', () => {
    expect(() => assertSupports(new InMemoryProvider({ pinIssues: true }), 'pinIssues', 'pinIssue', 'pinning'))
      .not
      .toThrow()
  })

  it('failure case - asserting an absent capability names the purpose', () => {
    // Where the capability *is* the command there is nothing to degrade to,
    // so a clear reason beats a TypeError or a silent success.
    expect(() => assertSupports(new InMemoryProvider(), 'branchHousekeeping', 'cleanupStaleBranches', 'branch cleanup'))
      .toThrow(/branch cleanup/)
  })

  it('success case - GitHub declares every capability', () => {
    const caps = new GitHubProvider('t', 'o', 'r').capabilities()

    expect(Object.values(caps).every(Boolean)).toBe(true)
  })
})

describe('platform-neutrality', () => {
  /** Files allowed to mention github.com, with why. */
  const ALLOWED = new Set([
    // The GitHub provider and its endpoint resolution — the platform edge.
    'src/git/github-provider.ts',
    'src/git/provider.ts',
    'src/utils/endpoints.ts',
    // Release notes and registries fetch from *dependency* repositories, which
    // are on github.com regardless of where this repository is hosted.
    'src/services/release-notes-fetcher.ts',
    'src/registry/registry-client.ts',
    'src/utils/zig-registry.ts',
    // Workflow generation emits GitHub Actions YAML by definition.
    'src/setup.ts',
    // Reporters and helpers that build links into the host repository.
    'src/security/reporters/github.ts',
    'src/utils/helpers.ts',
    'src/types.ts',
    // Documentation links to buddy-bot's own repository.
    'src/ai/providers/openai.ts',
    'src/pr/pr-generator.ts',
    'src/dashboard/dashboard-generator.ts',
  ])

  it('success case - github.com appears only where the platform is the subject', async () => {
    // Not a ban: a new hardcoded link in generic code is a portability
    // regression that this catches at the point it is introduced.
    const offenders: string[] = []

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(path)
          continue
        }
        if (!entry.name.endsWith('.ts'))
          continue
        if (ALLOWED.has(path))
          continue
        if ((await readFile(path, 'utf-8')).includes('github.com'))
          offenders.push(path)
      }
    }

    await walk('src')

    expect(offenders).toEqual([])
  })
})
