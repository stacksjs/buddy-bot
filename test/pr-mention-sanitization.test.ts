import type { UpdateGroup } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'

function makeGroup(): UpdateGroup {
  return {
    name: 'deps',
    title: '',
    body: '',
    updateType: 'minor',
    updates: [
      {
        name: 'example-pkg',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
        updateType: 'minor',
        dependencyType: 'dependencies',
        file: 'package.json',
      },
    ],
  }
}

describe('PR mention sanitization', () => {
  it('converts plain @mentions into non-pinging links', async () => {
    const gen = new PullRequestGenerator({ verbose: false }) as any

    // Mock fetchPackageInfo to inject release notes with mentions
    gen.releaseNotesFetcher.fetchPackageInfo = async () => ({
      packageInfo: { name: 'example-pkg', repository: { type: 'git', url: 'https://github.com/acme/example' } },
      compareUrl: 'https://github.com/acme/example/compare/v1.0.0...v1.1.0',
      changelog: [],
      releaseNotes: [
        {
          version: 'v1.1.0',
          date: new Date().toISOString(),
          title: 'Release',
          htmlUrl: 'https://github.com/acme/example/releases/v1.1.0',
          isPrerelease: false,
          body: [
            'Thanks to @sokra and @mischnic for contributions.',
            'Inline code: `doSomething(@nochange)`',
            'Fenced code:',
            '```ts',
            'const s = "@dont_touch"',
            '```',
            'Email: notify@example.com should not change.',
          ].join('\n'),
        },
      ],
    })

    const group = makeGroup()
    const body: string = await gen.generateBody(group)

    // Plain mentions converted (without '@' in rendered text)
    expect(body).toContain('[sokra](https://github.com/sokra)')
    expect(body).toContain('[mischnic](https://github.com/mischnic)')

    // No raw @mention should remain anywhere in non-code text
    expect(body).not.toMatch(/@sokra/)
    expect(body).not.toMatch(/@mischnic/)

    // Inline code preserved
    expect(body).toContain('`doSomething(@nochange)`')

    // Fenced code preserved
    expect(body).toContain('```ts')
    expect(body).toContain('const s = "@dont_touch"')

    // Emails not altered
    expect(body).toContain('notify@example.com')
  })
})
