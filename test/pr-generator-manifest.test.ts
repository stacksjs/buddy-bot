import type { PackageUpdate, UpdateGroup } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'
import { parseManifest } from '../src/pr/pr-manifest'

/** GitHub rejects pull request bodies longer than this. */
const GITHUB_BODY_LIMIT = 65536

function makeUpdate(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'typescript',
    currentVersion: '^5.8.2',
    newVersion: '^5.8.3',
    updateType: 'patch',
    dependencyType: 'devDependencies',
    file: 'package.json',
    ...overrides,
  }
}

function makeGroup(updates: PackageUpdate[], name = 'Non-Major Updates'): UpdateGroup {
  return {
    name,
    title: 'chore(deps): update dependencies',
    body: '',
    updateType: 'patch',
    updates,
  }
}

/** Generator with the network-backed release notes fetcher stubbed out. */
function makeGenerator(): PullRequestGenerator {
  const generator = new PullRequestGenerator({ verbose: false }) as any
  generator.releaseNotesFetcher.fetchPackageInfo = async () => null
  return generator
}

describe('PR generator manifest embedding', () => {
  it('success case - embeds a manifest describing every update', async () => {
    const updates = [
      makeUpdate(),
      makeUpdate({ name: 'actions/checkout', file: '.github/workflows/ci.yml', dependencyType: 'github-actions' }),
    ]

    const body = await makeGenerator().generateBody(makeGroup(updates))
    const manifest = parseManifest(body)

    expect(manifest).not.toBeNull()
    expect(manifest?.group).toBe('Non-Major Updates')
    expect(manifest?.updates.map(u => u.name).sort()).toEqual(['actions/checkout', 'typescript'])
  })

  it('success case - records the manifest for composer PRs', async () => {
    const updates = [makeUpdate({
      name: 'laravel/framework',
      currentVersion: '^10.0.0',
      newVersion: '^10.16.0',
      dependencyType: 'require',
      file: 'composer.json',
    })]

    const manifest = parseManifest(await makeGenerator().generateBody(makeGroup(updates)))

    expect(manifest?.updates[0]).toMatchObject({
      name: 'laravel/framework',
      current: '^10.0.0',
      target: '^10.16.0',
      file: 'composer.json',
    })
  })

  it('edge case - keeps a complete manifest for a large monorepo group', async () => {
    const updates = Array.from({ length: 100 }, (_, i) => makeUpdate({
      name: `@scope/package-${i}`,
      file: `packages/workspace-${i}/package.json`,
    }))

    const body = await makeGenerator().generateBody(makeGroup(updates))
    const manifest = parseManifest(body)

    expect(body.length).toBeLessThanOrEqual(GITHUB_BODY_LIMIT)
    expect(manifest?.updates).toHaveLength(100)
    expect(manifest?.truncated).toBeUndefined()
  })

  it('edge case - stays under the body limit when both prose and manifest overflow', async () => {
    // Enough updates to blow well past GitHub's limit before truncation.
    const updates = Array.from({ length: 400 }, (_, i) => makeUpdate({
      name: `@scope/a-fairly-long-package-name-${i}`,
      file: `packages/workspace-number-${i}/package.json`,
    }))

    const body = await makeGenerator().generateBody(makeGroup(updates))
    const manifest = parseManifest(body)

    expect(body.length).toBeLessThanOrEqual(GITHUB_BODY_LIMIT)
    // The manifest survives truncation of the prose, and says so when it had
    // to drop rows of its own.
    expect(manifest).not.toBeNull()
    expect(manifest?.truncated).toBe(true)
    expect(manifest?.updates.length).toBeGreaterThan(0)
  })

  it('edge case - emits exactly one manifest per body', async () => {
    const body = await makeGenerator().generateBody(makeGroup([makeUpdate()]))

    expect(body.match(/buddy-bot:manifest/g)).toHaveLength(1)
  })
})
