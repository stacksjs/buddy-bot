import type { AiClient, AiCompletionRequest, AiResponse } from '../src/ai/types'
import type { BuddyBotConfig, PackageUpdate } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { withManifest } from '../src/pr/pr-manifest'
import { analyzeGroupMajors, appendUpgradeReport, matchesGlobs } from '../src/upgrades/wire'

function makeUpdate(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'react',
    currentVersion: '17.0.2',
    newVersion: '19.0.0',
    updateType: 'major',
    dependencyType: 'dependencies',
    file: 'package.json',
    ...overrides,
  }
}

function scriptedClient(json: unknown): AiClient & { requests: AiCompletionRequest[] } {
  const requests: AiCompletionRequest[] = []
  return {
    provider: 'anthropic',
    model: 'test',
    tokensUsed: 0,
    requests,
    async complete(request): Promise<AiResponse> {
      requests.push(request)
      return {
        text: JSON.stringify(json),
        toolCalls: [],
        json,
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'test',
      }
    },
  }
}

const HIGH_CONFIDENCE = { changes: [], confidence: 'high', effort: 1, risks: [] }

function baseOptions(config: BuddyBotConfig, ai: AiClient | null) {
  return {
    config,
    workspace: '/tmp',
    baseBranch: 'main',
    files: [] as string[],
    ai,
    fetchReleases: async () => [{ version: '19.0.0', body: 'removed the legacy API' }],
  }
}

const ENABLED: BuddyBotConfig = { ai: { majorUpgrades: { enabled: true } } }

describe('package glob matching', () => {
  it('success case - no globs means everything qualifies', () => {
    expect(matchesGlobs('react', undefined)).toBe(true)
    expect(matchesGlobs('react', [])).toBe(true)
  })

  it('success case - matches a scope wildcard', () => {
    expect(matchesGlobs('@types/node', ['@types/*'])).toBe(true)
  })

  it('success case - matches a prefix wildcard', () => {
    expect(matchesGlobs('eslint-plugin-x', ['eslint*'])).toBe(true)
  })

  it('failure case - anchors at both ends', () => {
    // `react` must not match `react-dom`.
    expect(matchesGlobs('react-dom', ['react'])).toBe(false)
    expect(matchesGlobs('preact', ['react'])).toBe(false)
  })

  it('failure case - a non-matching glob excludes the package', () => {
    expect(matchesGlobs('react', ['@types/*'])).toBe(false)
  })

  it('edge case - regex metacharacters in a name are literal', () => {
    expect(matchesGlobs('a.b', ['a.b'])).toBe(true)
    expect(matchesGlobs('axb', ['a.b'])).toBe(false)
  })
})

describe('group major analysis', () => {
  it('success case - with the feature off nothing is produced', async () => {
    const outcome = await analyzeGroupMajors({
      ...baseOptions({}, scriptedClient(HIGH_CONFIDENCE)),
      updates: [makeUpdate()],
    })

    expect(outcome).toEqual({ report: '', draft: false, results: [], skipped: [] })
  })

  it('success case - with no AI client nothing is produced', async () => {
    // The dependency bot must behave exactly as before with no key configured.
    const outcome = await analyzeGroupMajors({
      ...baseOptions(ENABLED, null),
      updates: [makeUpdate()],
    })

    expect(outcome.report).toBe('')
  })

  it('success case - a group with no majors is left alone', async () => {
    const outcome = await analyzeGroupMajors({
      ...baseOptions(ENABLED, scriptedClient(HIGH_CONFIDENCE)),
      updates: [makeUpdate({ updateType: 'patch', newVersion: '17.0.3' })],
    })

    expect(outcome.report).toBe('')
  })

  it('success case - analyses a major and reports it per package', async () => {
    const outcome = await analyzeGroupMajors({
      ...baseOptions(ENABLED, scriptedClient(HIGH_CONFIDENCE)),
      updates: [makeUpdate()],
    })

    expect(outcome.report).toContain('Major upgrade analysis')
    expect(outcome.report).toContain('react 17.0.2 → 19.0.0')
    expect(outcome.results).toHaveLength(1)
  })

  it('success case - feeds span notes to the analysis', async () => {
    // The whole point of the span walk: the model must see the release that
    // describes the break, not just the newest tag.
    const ai = scriptedClient(HIGH_CONFIDENCE)

    await analyzeGroupMajors({
      ...baseOptions(ENABLED, ai),
      updates: [makeUpdate()],
      fetchReleases: async () => [
        { version: '19.0.0', body: 'dropped defaultProps' },
        { version: '18.0.0', body: 'render moved to createRoot' },
      ],
    })

    expect(ai.requests[0].messages[0].content).toContain('render moved to createRoot')
  })

  it('success case - a low-confidence plan asks for a draft', async () => {
    const outcome = await analyzeGroupMajors({
      ...baseOptions(ENABLED, scriptedClient({ changes: [], confidence: 'low', effort: 5, risks: [] })),
      updates: [makeUpdate()],
    })

    expect(outcome.draft).toBe(true)
  })

  it('success case - respects the package globs', async () => {
    const config: BuddyBotConfig = { ai: { majorUpgrades: { enabled: true, packages: ['@types/*'] } } }

    const outcome = await analyzeGroupMajors({
      ...baseOptions(config, scriptedClient(HIGH_CONFIDENCE)),
      updates: [makeUpdate()],
    })

    expect(outcome.results).toHaveLength(0)
    expect(outcome.skipped[0]).toMatchObject({ name: 'react' })
  })

  it('success case - names packages it did not analyse', async () => {
    // Otherwise the section reads as complete coverage of the group's majors.
    const config: BuddyBotConfig = { ai: { majorUpgrades: { enabled: true, packages: ['vue'] } } }

    const outcome = await analyzeGroupMajors({
      ...baseOptions(config, scriptedClient(HIGH_CONFIDENCE)),
      updates: [makeUpdate(), makeUpdate({ name: 'vue', currentVersion: '2.0.0', newVersion: '3.0.0' })],
    })

    expect(outcome.report).toContain('Not analysed:')
    expect(outcome.report).toContain('`react`')
  })

  it('failure case - an analysis error skips the package, not the PR', async () => {
    // A blocked dependency update costs far more than a missing report.
    const outcome = await analyzeGroupMajors({
      ...baseOptions(ENABLED, scriptedClient(HIGH_CONFIDENCE)),
      updates: [makeUpdate()],
      fetchReleases: async () => {
        throw new Error('registry down')
      },
    })

    expect(outcome.skipped[0]).toEqual({ name: 'react', reason: 'analysis failed' })
    expect(outcome.draft).toBe(false)
  })

  it('success case - flags an analysis that had no release notes', async () => {
    const outcome = await analyzeGroupMajors({
      ...baseOptions(ENABLED, scriptedClient(HIGH_CONFIDENCE)),
      updates: [makeUpdate()],
      fetchReleases: async () => [],
    })

    expect(outcome.report).toContain('usage sites alone')
  })
})

describe('report placement', () => {
  it('success case - the manifest stays last in the body', async () => {
    // The manifest parser expects it there, and rebase reads it back.
    const body = withManifest('## Tables\n\nrows', [makeUpdate()])

    const spliced = appendUpgradeReport(body, '## Major upgrade analysis\n\nreport')

    expect(spliced.indexOf('Major upgrade analysis')).toBeGreaterThan(spliced.indexOf('## Tables'))
    expect(spliced.indexOf('Major upgrade analysis')).toBeLessThan(spliced.indexOf('buddy-bot:manifest'))
  })

  it('success case - an empty report leaves the body untouched', () => {
    const body = withManifest('## Tables', [makeUpdate()])

    expect(appendUpgradeReport(body, '')).toBe(body)
    expect(appendUpgradeReport(body, '   ')).toBe(body)
  })

  it('success case - a body with no manifest still takes the report', () => {
    expect(appendUpgradeReport('## Tables', 'report')).toContain('report')
  })
})
