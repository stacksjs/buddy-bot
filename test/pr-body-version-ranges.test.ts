import { beforeAll, describe, expect, it } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'
import { ReleaseNotesFetcher } from '../src/services/release-notes-fetcher'

describe('PR body version ranges', () => {
  beforeAll(() => {
    process.env.APP_ENV = 'test'
  })

  it('keeps compound npm ranges inside one table cell and URL-encodes links', async () => {
    const generator = new PullRequestGenerator({
      repository: {
        provider: 'github',
        owner: 'stacksjs',
        name: 'stacks',
      },
    })

    const body = await generator.generateBody({
      name: 'Major Update - acorn',
      title: 'chore(deps): update dependency acorn to 8.17.0',
      body: '',
      updateType: 'major',
      updates: [{
        name: 'acorn',
        currentVersion: '^6.0.0 || ^7.0.0 || ^8.0.0',
        newVersion: '8.17.0',
        updateType: 'major',
        dependencyType: 'peerDependencies',
        file: 'package.json',
      }],
    })

    expect(body).toContain('`^6.0.0 \\|\\| ^7.0.0 \\|\\| ^8.0.0`')
    expect(body).toContain('%5E6.0.0%20%7C%7C%20%5E7.0.0%20%7C%7C%20%5E8.0.0')
    expect(body).toContain('/compare/v8.0.0...v8.17.0')
    expect(body).not.toContain('/compare/v^6.0.0 ||')
  })

  it('bounds release selection to the requested range', () => {
    const fetcher = new ReleaseNotesFetcher() as any

    expect(fetcher.isVersionBetween('8.16.0', '^6.0.0 || ^7.0.0 || ^8.0.0', '8.17.0')).toBe(true)
    expect(fetcher.isVersionBetween('9.0.0', '^6.0.0 || ^7.0.0 || ^8.0.0', '8.17.0')).toBe(false)
    expect(fetcher.isVersionBetween('8.0.0', '^6.0.0 || ^7.0.0 || ^8.0.0', '8.17.0')).toBe(false)
  })
})
