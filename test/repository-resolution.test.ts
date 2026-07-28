import type { BuddyBotConfig } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { resolveRepositoryConfig } from '../src/utils/repository'

function makeConfig(overrides: Partial<BuddyBotConfig> = {}): BuddyBotConfig {
  return {
    repository: { owner: '', name: '', provider: 'github' },
    ...overrides,
  } as BuddyBotConfig
}

describe('resolveRepositoryConfig', () => {
  it('fills in an unconfigured repository from GITHUB_REPOSITORY', () => {
    const config = makeConfig()
    const result = resolveRepositoryConfig(config, { GITHUB_REPOSITORY: 'theopenfarm/openfarm.ing' })

    expect(config.repository!.owner).toBe('theopenfarm')
    expect(config.repository!.name).toBe('openfarm.ing')
    expect(result.source).toBe('environment')
    expect(result.overrodeConfig).toBe(false)
    expect(result.warning).toBeUndefined()
  })

  it('overrides a configured repository that disagrees with GITHUB_REPOSITORY', () => {
    // Regression: a config copy-pasted from another project pointed every API
    // call at stacksjs/stacks while running inside theopenfarm/openfarm.ing.
    const config = makeConfig({ repository: { owner: 'stacksjs', name: 'stacks', provider: 'github' } })
    const result = resolveRepositoryConfig(config, { GITHUB_REPOSITORY: 'theopenfarm/openfarm.ing' })

    expect(config.repository!.owner).toBe('theopenfarm')
    expect(config.repository!.name).toBe('openfarm.ing')
    expect(result.overrodeConfig).toBe(true)
    expect(result.source).toBe('environment')
    expect(result.warning).toContain('stacksjs/stacks')
    expect(result.warning).toContain('theopenfarm/openfarm.ing')
  })

  it('drops a stale dashboard issue number when the repository is overridden', () => {
    const config = makeConfig({
      repository: { owner: 'stacksjs', name: 'stacks', provider: 'github' },
      dashboard: { enabled: true, issueNumber: 1911 },
    })

    resolveRepositoryConfig(config, { GITHUB_REPOSITORY: 'theopenfarm/openfarm.ing' })

    // #1911 belongs to stacksjs/stacks; keeping it would PATCH a foreign issue
    expect(config.dashboard!.issueNumber).toBeUndefined()
  })

  it('keeps a dashboard issue number when the repository matches', () => {
    const config = makeConfig({
      repository: { owner: 'theopenfarm', name: 'openfarm.ing', provider: 'github' },
      dashboard: { enabled: true, issueNumber: 42 },
    })

    const result = resolveRepositoryConfig(config, { GITHUB_REPOSITORY: 'theopenfarm/openfarm.ing' })

    expect(config.dashboard!.issueNumber).toBe(42)
    expect(result.overrodeConfig).toBe(false)
    expect(result.source).toBe('config')
  })

  it('leaves the configured repository alone outside GitHub Actions', () => {
    const config = makeConfig({ repository: { owner: 'stacksjs', name: 'stacks', provider: 'github' } })
    const result = resolveRepositoryConfig(config, {})

    expect(config.repository!.owner).toBe('stacksjs')
    expect(config.repository!.name).toBe('stacks')
    expect(result.source).toBe('config')
    expect(result.warning).toBeUndefined()
  })

  it('edge case - ignores a malformed GITHUB_REPOSITORY', () => {
    const config = makeConfig({ repository: { owner: 'stacksjs', name: 'stacks', provider: 'github' } })
    const result = resolveRepositoryConfig(config, { GITHUB_REPOSITORY: 'no-slash' })

    expect(config.repository!.owner).toBe('stacksjs')
    expect(result.source).toBe('config')
  })

  it('edge case - reports unresolved when nothing is available', () => {
    const config = makeConfig()
    const result = resolveRepositoryConfig(config, {})

    expect(result.source).toBe('unresolved')
    expect(result.owner).toBeUndefined()
  })

  it('edge case - handles a config with no repository block', () => {
    const config = {} as BuddyBotConfig
    const result = resolveRepositoryConfig(config, { GITHUB_REPOSITORY: 'a/b' })

    expect(result.source).toBe('unresolved')
    expect(result.overrodeConfig).toBe(false)
  })
})
