import { afterEach, describe, expect, it } from 'bun:test'
import {
  compareVersions,
  parseTag,
  sameVariant,
  selectLatestTag,
  tagUpdateType,
} from '../src/registry/docker-tags'
import {
  apiHostFor,
  formatImageRef,
  nextPageUrl,
  OciClient,
  parseAuthChallenge,
  parseImageRef,
  resolveCredentials,
  tokenUrlFor,
} from '../src/registry/oci-client'
import { validateConfig } from '../src/config-validation'
import { checkDependencies } from '../src/gates/checks'
import { checkEol, cycleFor, describeEol, productFor } from '../src/registry/eol'
import { Logger } from '../src/utils/logger'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('image reference parsing', () => {
  it('success case - an official image gets the library namespace', () => {
    // `library/` is elided when written but required by the API.
    expect(parseImageRef('alpine:3.19')).toEqual({
      registry: 'docker.io',
      repository: 'library/alpine',
      tag: '3.19',
    })
  })

  it('success case - a namespaced Docker Hub image keeps its namespace', () => {
    expect(parseImageRef('alpine/git:2.40')).toMatchObject({
      registry: 'docker.io',
      repository: 'alpine/git',
    })
  })

  it('failure case - a first segment without a dot is a namespace, not a host', () => {
    // Treating `alpine` as a host would send credentials to a machine that
    // does not exist.
    expect(parseImageRef('alpine/git').registry).toBe('docker.io')
  })

  it('success case - a dotted first segment is a registry', () => {
    expect(parseImageRef('ghcr.io/org/app:1.2.3')).toEqual({
      registry: 'ghcr.io',
      repository: 'org/app',
      tag: '1.2.3',
    })
  })

  it('success case - localhost is a registry', () => {
    expect(parseImageRef('localhost/app:1').registry).toBe('localhost')
  })

  it('success case - a port in the host is not a tag', () => {
    // The tag separator is the last colon after the last slash.
    expect(parseImageRef('registry.local:5000/team/app:2.1')).toEqual({
      registry: 'registry.local:5000',
      repository: 'team/app',
      tag: '2.1',
    })
  })

  it('success case - a digest is separated from the tag', () => {
    const ref = parseImageRef('node:20@sha256:abc')

    expect(ref.tag).toBe('20')
    expect(ref.digest).toBe('sha256:abc')
  })

  it('edge case - a bare name defaults to latest', () => {
    expect(parseImageRef('nginx').tag).toBe('latest')
  })

  it('success case - formatting round-trips', () => {
    for (const image of ['alpine:3.19', 'ghcr.io/org/app:1.0', 'registry.local:5000/t/a:2'])
      expect(formatImageRef(parseImageRef(image))).toBe(image)
  })

  it('success case - Docker Hub resolves to its API host', () => {
    expect(apiHostFor('docker.io')).toBe('registry-1.docker.io')
    expect(apiHostFor('ghcr.io')).toBe('ghcr.io')
  })
})

describe('credential resolution', () => {
  it('success case - reads a configured password from the environment', () => {
    const credentials = resolveCredentials(
      'quay.io',
      { 'quay.io': { username: 'me', passwordEnv: 'QUAY_PASSWORD' } },
      { QUAY_PASSWORD: 'secret' },
    )

    expect(credentials).toEqual({ username: 'me', password: 'secret' })
  })

  it('success case - a pre-issued token wins over basic auth', () => {
    const credentials = resolveCredentials(
      'gcr.io',
      { 'gcr.io': { username: 'x', passwordEnv: 'P', tokenEnv: 'T' } },
      { P: 'p', T: 't' },
    )

    expect(credentials).toEqual({ token: 't' })
  })

  it('success case - ghcr falls back to the ambient GitHub token', () => {
    // Private GHCR images then work in Actions with no configuration at all.
    expect(resolveCredentials('ghcr.io', undefined, { GITHUB_TOKEN: 'gh' }))
      .toEqual({ username: 'buddy-bot', password: 'gh' })
  })

  it('failure case - nothing configured means anonymous', () => {
    expect(resolveCredentials('quay.io', undefined, {})).toBeNull()
  })

  it('failure case - a named variable that is unset means anonymous', () => {
    expect(resolveCredentials('quay.io', { 'quay.io': { username: 'm', passwordEnv: 'NOPE' } }, {}))
      .toBeNull()
  })
})

describe('bearer challenges', () => {
  it('success case - parses realm, service and scope', () => {
    expect(parseAuthChallenge('Bearer realm="https://auth.test/token",service="registry",scope="repository:a/b:pull"'))
      .toEqual({ realm: 'https://auth.test/token', service: 'registry', scope: 'repository:a/b:pull' })
  })

  it('failure case - a non-bearer challenge is not honoured', () => {
    expect(parseAuthChallenge('Basic realm="x"')).toBeNull()
    expect(parseAuthChallenge(null)).toBeNull()
  })

  it('failure case - a challenge without a realm is unusable', () => {
    expect(parseAuthChallenge('Bearer service="registry"')).toBeNull()
  })

  it('success case - builds a pull-scoped token URL', () => {
    const url = tokenUrlFor({ realm: 'https://auth.test/token', service: 'registry' }, 'org/app')

    expect(url).toContain('service=registry')
    expect(url).toContain('scope=repository%3Aorg%2Fapp%3Apull')
  })

  it('success case - an explicit scope is preserved', () => {
    expect(tokenUrlFor({ realm: 'https://a.test/t', scope: 'repository:x:pull,push' }, 'org/app'))
      .toContain('push')
  })
})

describe('tag pagination', () => {
  it('success case - follows a relative next link', () => {
    expect(nextPageUrl('</v2/a/tags/list?n=100&last=x>; rel="next"', 'ghcr.io'))
      .toBe('https://ghcr.io/v2/a/tags/list?n=100&last=x')
  })

  it('success case - honours an absolute next link', () => {
    expect(nextPageUrl('<https://other.test/v2/x>; rel="next"', 'ghcr.io'))
      .toBe('https://other.test/v2/x')
  })

  it('edge case - no link means no next page', () => {
    expect(nextPageUrl(null, 'ghcr.io')).toBeNull()
    expect(nextPageUrl('</v2/a>; rel="prev"', 'ghcr.io')).toBeNull()
  })
})

describe('tag parsing', () => {
  it('success case - splits version from variant', () => {
    expect(parseTag('20.11.1-alpine3.19')).toMatchObject({
      version: [20, 11, 1],
      suffix: 'alpine3.19',
      prerelease: false,
    })
  })

  it('success case - tolerates a v prefix', () => {
    expect(parseTag('v1.2')?.version).toEqual([1, 2])
  })

  it('success case - detects prereleases', () => {
    expect(parseTag('2.0.0-rc1')?.prerelease).toBe(true)
    expect(parseTag('2.0.0-beta')?.prerelease).toBe(true)
    expect(parseTag('2.0.0-alpine')?.prerelease).toBe(false)
  })

  it('failure case - a non-version tag has no version', () => {
    expect(parseTag('latest')).toBeNull()
    expect(parseTag('bookworm')).toBeNull()
  })

  it('success case - compares versions of differing length', () => {
    expect(compareVersions([1, 2], [1, 10])).toBeLessThan(0)
    expect(compareVersions([2], [1, 9, 9])).toBeGreaterThan(0)
    expect(compareVersions([1, 2, 3], [1, 2])).toBeGreaterThan(0)
  })

  it('success case - variants compare by their leading word', () => {
    // Otherwise a node:20-alpine3.18 image would never see an update, since
    // every newer tag carries a different alpine version.
    expect(sameVariant('alpine3.18', 'alpine3.19')).toBe(true)
    expect(sameVariant('alpine', 'slim')).toBe(false)
    expect(sameVariant('', '')).toBe(true)
  })
})

describe('tag selection', () => {
  it('success case - finds the newest matching tag', () => {
    expect(selectLatestTag('20.10', ['20.11', '20.9', '21.0'])).toBe('21.0')
  })

  it('failure case - never crosses a variant boundary', () => {
    // Swapping the base distribution would break every later `RUN apk add`.
    expect(selectLatestTag('20.10-alpine', ['20.11-slim', '21.0'])).toBeNull()
    expect(selectLatestTag('20.10-alpine', ['20.11-alpine', '21.0-slim'])).toBe('20.11-alpine')
  })

  it('success case - a variant moves within its own family', () => {
    expect(selectLatestTag('20.10-alpine3.18', ['20.11-alpine3.19'])).toBe('20.11-alpine3.19')
  })

  it('success case - preserves the author\'s precision', () => {
    // Someone who pinned `18` chose that; rewriting it to 18.20.4 is a
    // different decision than updating it.
    expect(selectLatestTag('18', ['19', '18.20.4'])).toBe('19')
    expect(selectLatestTag('18.20', ['18.21', '19.0.0'])).toBe('18.21')
  })

  it('failure case - excludes prereleases by default', () => {
    expect(selectLatestTag('1.0', ['2.0-rc1'])).toBeNull()
    expect(selectLatestTag('1.0', ['2.0-rc1'], { includePrerelease: true })).toBe('2.0-rc1')
  })

  it('failure case - a floating tag is left alone', () => {
    // `latest` is a moving target the registry already updates; pinning it
    // would override a deliberate choice.
    expect(selectLatestTag('latest', ['1.0', '2.0'])).toBeNull()
    expect(selectLatestTag('bookworm', ['1.0'])).toBeNull()
  })

  it('failure case - no newer tag yields nothing', () => {
    expect(selectLatestTag('3.0', ['1.0', '2.0', '3.0'])).toBeNull()
  })

  it('edge case - ignores unparseable tags in the list', () => {
    expect(selectLatestTag('1.0', ['latest', 'main', '2.0'])).toBe('2.0')
  })

  it('success case - classifies the update type', () => {
    expect(tagUpdateType('1.2.3', '2.0.0')).toBe('major')
    expect(tagUpdateType('1.2.3', '1.3.0')).toBe('minor')
    expect(tagUpdateType('1.2.3', '1.2.4')).toBe('patch')
  })
})

describe('OCI client', () => {
  it('success case - lists tags from an anonymous registry', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tags: ['1.0', '1.1'] }), { status: 200 })) as unknown as typeof fetch

    const tags = await new OciClient({ logger: Logger.silent() })
      .listTags(parseImageRef('quay.io/org/app:1.0'))

    expect(tags).toEqual(['1.0', '1.1'])
  })

  it('success case - honours a bearer challenge and retries', async () => {
    // This one flow is what unlocks GHCR, Quay, GCR and most private
    // registries — they all answer anonymously with a 401 naming the realm.
    const seen: string[] = []

    globalThis.fetch = (async (url: string) => {
      seen.push(String(url))

      if (String(url).includes('/token'))
        return new Response(JSON.stringify({ token: 'issued' }), { status: 200 })

      if (seen.filter(entry => entry.includes('tags/list')).length === 1) {
        return new Response('', {
          status: 401,
          headers: { 'www-authenticate': 'Bearer realm="https://auth.test/token",service="registry"' },
        })
      }

      return new Response(JSON.stringify({ tags: ['2.0'] }), { status: 200 })
    }) as unknown as typeof fetch

    const tags = await new OciClient({ logger: Logger.silent() })
      .listTags(parseImageRef('ghcr.io/org/app:1.0'))

    expect(tags).toEqual(['2.0'])
    expect(seen.some(url => url.includes('auth.test/token'))).toBe(true)
  })

  it('failure case - an unreachable registry yields no tags rather than throwing', async () => {
    // A registry outage must not fail the whole dependency scan.
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    expect(await new OciClient({ logger: Logger.silent() }).listTags(parseImageRef('quay.io/a/b:1')))
      .toEqual([])
  })

  it('failure case - a 401 with no usable challenge stops rather than looping', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response('', { status: 401 })
    }) as unknown as typeof fetch

    expect(await new OciClient({ logger: Logger.silent() }).listTags(parseImageRef('quay.io/a/b:1')))
      .toEqual([])
    expect(calls).toBe(1)
  })

  it('success case - resolves a tag to its digest', async () => {
    globalThis.fetch = (async () =>
      new Response('', { status: 200, headers: { 'docker-content-digest': 'sha256:abc' } })) as unknown as typeof fetch

    expect(await new OciClient({ logger: Logger.silent() }).resolveDigest(parseImageRef('quay.io/a/b:1')))
      .toBe('sha256:abc')
  })

  it('success case - follows pagination', async () => {
    let page = 0
    globalThis.fetch = (async () => {
      page++
      return page === 1
        ? new Response(JSON.stringify({ tags: ['1.0'] }), {
            status: 200,
            headers: { link: '</v2/a/b/tags/list?last=1.0>; rel="next"' },
          })
        : new Response(JSON.stringify({ tags: ['2.0'] }), { status: 200 })
    }) as unknown as typeof fetch

    expect(await new OciClient({ logger: Logger.silent() }).listTags(parseImageRef('quay.io/a/b:1')))
      .toEqual(['1.0', '2.0'])
  })
})

describe('prerelease and variant separation', () => {
  it('success case - a prerelease marker is not a variant', () => {
    // A variant says which image this is; a marker says how finished it is.
    // Conflating them makes 2.0-rc1 a different image from 2.0.
    expect(parseTag('2.0-rc1')?.suffix).toBe('')
    expect(parseTag('2.0-rc1')?.prerelease).toBe(true)
  })

  it('success case - a variant survives a prerelease marker', () => {
    expect(parseTag('2.0-rc1-alpine')).toMatchObject({ suffix: 'alpine', prerelease: true })
  })

  it('success case - a prerelease upgrade keeps the plain variant', () => {
    expect(selectLatestTag('1.0', ['2.0-rc1'], { includePrerelease: true })).toBe('2.0-rc1')
  })

  it('success case - detects the numbered marker forms projects publish', () => {
    for (const tag of ['1.0-rc1', '1.0-beta2', '1.0-alpha3', '1.0-nightly'])
      expect(parseTag(tag)?.prerelease).toBe(true)
  })

  it('failure case - a variant that merely starts with a marker word is not one', () => {
    expect(parseTag('1.0-devel')?.prerelease).toBe(false)
  })
})

describe('docker registry configuration', () => {
  it('success case - accepts a full credential', () => {
    expect(validateConfig({
      registries: { docker: { 'quay.io': { username: 'me', passwordEnv: 'QUAY_PASSWORD' } } },
    })).toEqual([])
  })

  it('success case - a token-only credential needs no username', () => {
    expect(validateConfig({
      registries: { docker: { 'gcr.io': { tokenEnv: 'GCR_TOKEN' } } },
    })).toEqual([])
  })

  it('failure case - a username without a secret is half a credential', () => {
    // It fails at the registry rather than here unless it is caught.
    const issues = validateConfig({ registries: { docker: { 'quay.io': { username: 'me' } } } })

    expect(issues[0].path).toBe('registries.docker.quay.io.passwordEnv')
  })

  it('failure case - a secret without a username is the other half', () => {
    const issues = validateConfig({ registries: { docker: { 'quay.io': { passwordEnv: 'P' } } } })

    expect(issues[0].path).toBe('registries.docker.quay.io.username')
  })

  it('failure case - rejects a non-object entry', () => {
    expect(validateConfig({ registries: { docker: { 'quay.io': 'token' as never } } })).toHaveLength(1)
  })
})

describe('base image end of life', () => {
  const CYCLES = [
    { cycle: '22', eol: '2027-04-30', latest: '22.3.0' },
    { cycle: '20', eol: '2026-04-30', latest: '20.11.1' },
    { cycle: '18', eol: '2025-04-30', latest: '18.20.4' },
    { cycle: 'rolling', eol: false },
  ]

  function mockEol(cycles: unknown): void {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(cycles), { status: 200 })) as unknown as typeof fetch
  }

  it('success case - maps an image onto its product slug', () => {
    // Mapped explicitly: an image whose slug is guessed wrong would report a
    // support window belonging to something else.
    expect(productFor('node')).toBe('nodejs')
    expect(productFor('library/node')).toBe('nodejs')
    expect(productFor('golang')).toBe('go')
  })

  it('failure case - an untracked image has no product', () => {
    expect(productFor('ghcr.io/org/app')).toBeNull()
  })

  it('success case - resolves the cycle a tag belongs to', () => {
    expect(cycleFor('20.11-alpine', CYCLES)?.cycle).toBe('20')
    expect(cycleFor('18', CYCLES)?.cycle).toBe('18')
  })

  it('success case - prefers the most specific cycle', () => {
    // Reporting `3` when `3.18` exists means reporting the wrong window.
    const alpine = [{ cycle: '3', eol: false }, { cycle: '3.18', eol: '2025-05-09' }]

    expect(cycleFor('3.18', alpine)?.cycle).toBe('3.18')
  })

  it('failure case - a non-version tag belongs to no cycle', () => {
    expect(cycleFor('latest', CYCLES)).toBeNull()
  })

  it('success case - reports a cycle past its end of life', async () => {
    mockEol(CYCLES)

    const status = await checkEol('node', '18-alpine', {
      now: new Date('2026-08-14'),
      logger: Logger.silent(),
    })

    expect(status).toMatchObject({ product: 'nodejs', cycle: '18', eol: true })
    expect(status!.daysRemaining).toBeLessThan(0)
  })

  it('success case - a supported cycle is not flagged', async () => {
    mockEol(CYCLES)

    const status = await checkEol('node', '22', { now: new Date('2026-08-14'), logger: Logger.silent() })

    expect(status?.eol).toBe(false)
    expect(describeEol(status)).toBe('')
  })

  it('success case - warns about an approaching end of life', async () => {
    mockEol(CYCLES)

    const status = await checkEol('node', '20', { now: new Date('2026-04-01'), logger: Logger.silent() })

    expect(describeEol(status)).toContain('reaches end of life in')
  })

  it('failure case - a cycle with no announced end is supported, not unknown', async () => {
    // Reporting it as a risk would be wrong.
    mockEol(CYCLES)

    const status = await checkEol('node', 'rolling', { logger: Logger.silent() })

    expect(status).toBeNull()
  })

  it('failure case - an unreachable API yields nothing rather than throwing', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    expect(await checkEol('node', '18', { logger: Logger.silent() })).toBeNull()
  })

  it('failure case - an untracked image is not looked up at all', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('[]', { status: 200 })
    }) as unknown as typeof fetch

    expect(await checkEol('ghcr.io/org/app', '1.0', { logger: Logger.silent() })).toBeNull()
    expect(called).toBe(false)
  })

  it('success case - an EOL image is a dependency-gate violation', () => {
    const result = checkDependencies(
      [{ name: 'node', version: '18', eol: 'node 18 reached end of life' }],
      { mode: 'error' },
    )

    expect(result.passed).toBe(false)
    expect(result.detail).toContain('end of life')
  })

  it('success case - the EOL block can be turned off', () => {
    const result = checkDependencies(
      [{ name: 'node', version: '18', eol: 'node 18 reached end of life' }],
      { mode: 'error', blockEol: false },
    )

    expect(result.passed).toBe(true)
  })
})
