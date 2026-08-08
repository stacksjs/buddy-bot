import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  clearNpmrcCache,
  DEFAULT_COMPOSER_REGISTRY,
  DEFAULT_GITHUB_API_URL,
  DEFAULT_NPM_REGISTRY,
  getComposerRegistryUrl,
  getGitHubApiUrl,
  getGitHubServerUrl,
  getNpmRegistryUrl,
} from '../src/utils/endpoints'

// HOME is included so `os.homedir()` resolves into a scratch directory:
// otherwise these assertions would depend on whatever `registry=` the machine
// running the suite happens to have in its own ~/.npmrc.
const ENV_KEYS = [
  'GITHUB_API_URL',
  'GITHUB_SERVER_URL',
  'NPM_CONFIG_REGISTRY',
  'COMPOSER_REGISTRY_URL',
  'HOME',
] as const

describe('endpoints', () => {
  const saved: Record<string, string | undefined> = {}
  let root: string
  let workdir: string

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    root = mkdtempSync(join(tmpdir(), 'buddy-endpoints-'))
    workdir = join(root, 'project')
    mkdirSync(workdir, { recursive: true })
    mkdirSync(join(root, 'home'), { recursive: true })
    process.env.HOME = join(root, 'home')
    clearNpmrcCache()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined)
        delete process.env[key]
      else
        process.env[key] = saved[key]
    }
    rmSync(root, { recursive: true, force: true })
    clearNpmrcCache()
  })

  describe('getGitHubApiUrl', () => {
    it('should default to the public API host', () => {
      expect(getGitHubApiUrl()).toBe(DEFAULT_GITHUB_API_URL)
    })

    it('should honour GITHUB_API_URL, which Actions sets on GHES runners', () => {
      process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3'
      expect(getGitHubApiUrl()).toBe('https://github.acme.com/api/v3')
    })

    it('should let explicit config win over the environment', () => {
      process.env.GITHUB_API_URL = 'https://from-env.example/api/v3'
      const url = getGitHubApiUrl({
        repository: { provider: 'github', owner: 'a', name: 'b', apiUrl: 'https://from-config.example/api/v3' },
      })
      expect(url).toBe('https://from-config.example/api/v3')
    })

    it('edge case - strips a trailing slash so paths concatenate cleanly', () => {
      process.env.GITHUB_API_URL = 'https://github.acme.com/api/v3/'
      expect(getGitHubApiUrl()).toBe('https://github.acme.com/api/v3')
    })

    it('edge case - ignores an empty environment value', () => {
      process.env.GITHUB_API_URL = '   '
      expect(getGitHubApiUrl()).toBe(DEFAULT_GITHUB_API_URL)
    })
  })

  describe('getGitHubServerUrl', () => {
    it('should default to the public web host', () => {
      expect(getGitHubServerUrl()).toBe('https://github.com')
    })

    it('should honour GITHUB_SERVER_URL', () => {
      process.env.GITHUB_SERVER_URL = 'https://github.acme.com'
      expect(getGitHubServerUrl()).toBe('https://github.acme.com')
    })
  })

  describe('getNpmRegistryUrl', () => {
    it('should default to the public registry', () => {
      expect(getNpmRegistryUrl('react', undefined, workdir)).toBe(DEFAULT_NPM_REGISTRY)
    })

    it('should honour NPM_CONFIG_REGISTRY', () => {
      process.env.NPM_CONFIG_REGISTRY = 'https://npm.acme.com'
      expect(getNpmRegistryUrl('react', undefined, workdir)).toBe('https://npm.acme.com')
    })

    it('should read a default registry from .npmrc', () => {
      writeFileSync(join(workdir, '.npmrc'), 'registry=https://npm.internal/\n')
      clearNpmrcCache()

      expect(getNpmRegistryUrl('react', undefined, workdir)).toBe('https://npm.internal')
    })

    it('should read a scoped registry from .npmrc', () => {
      writeFileSync(
        join(workdir, '.npmrc'),
        'registry=https://npm.internal\n@acme:registry=https://npm.acme.com\n',
      )
      clearNpmrcCache()

      expect(getNpmRegistryUrl('@acme/ui', undefined, workdir)).toBe('https://npm.acme.com')
      expect(getNpmRegistryUrl('react', undefined, workdir)).toBe('https://npm.internal')
    })

    it('should let config scopes win over .npmrc', () => {
      writeFileSync(join(workdir, '.npmrc'), '@acme:registry=https://from-npmrc.example\n')
      clearNpmrcCache()

      const url = getNpmRegistryUrl(
        '@acme/ui',
        { registries: { npmScopes: { '@acme': 'https://from-config.example' } } },
        workdir,
      )
      expect(url).toBe('https://from-config.example')
    })

    it('edge case - ignores comments and blank lines in .npmrc', () => {
      writeFileSync(
        join(workdir, '.npmrc'),
        '# a comment\n\n; another\nregistry=https://npm.internal\n',
      )
      clearNpmrcCache()

      expect(getNpmRegistryUrl('react', undefined, workdir)).toBe('https://npm.internal')
    })

    it('edge case - expands ${VAR} references in .npmrc', () => {
      process.env.NPM_HOST_FOR_TEST = 'https://expanded.example'
      writeFileSync(join(workdir, '.npmrc'), 'registry=${NPM_HOST_FOR_TEST}\n')
      clearNpmrcCache()

      try {
        expect(getNpmRegistryUrl('react', undefined, workdir)).toBe('https://expanded.example')
      }
      finally {
        delete process.env.NPM_HOST_FOR_TEST
      }
    })

    it('edge case - unscoped lookup falls back to the default registry', () => {
      writeFileSync(join(workdir, '.npmrc'), '@acme:registry=https://npm.acme.com\n')
      clearNpmrcCache()

      expect(getNpmRegistryUrl('react', undefined, workdir)).toBe(DEFAULT_NPM_REGISTRY)
    })
  })

  describe('.npmrc precedence', () => {
    it('should let the project .npmrc override the home one', () => {
      writeFileSync(join(root, 'home', '.npmrc'), 'registry=https://home.example\n')
      writeFileSync(join(workdir, '.npmrc'), 'registry=https://project.example\n')
      clearNpmrcCache()

      expect(getNpmRegistryUrl('react', undefined, workdir)).toBe('https://project.example')
    })

    it('should fall back to the home .npmrc when the project has none', () => {
      writeFileSync(join(root, 'home', '.npmrc'), 'registry=https://home.example\n')
      clearNpmrcCache()

      expect(getNpmRegistryUrl('react', undefined, workdir)).toBe('https://home.example')
    })
  })

  describe('getComposerRegistryUrl', () => {
    it('should default to Packagist', () => {
      expect(getComposerRegistryUrl()).toBe(DEFAULT_COMPOSER_REGISTRY)
    })

    it('should honour explicit config', () => {
      expect(getComposerRegistryUrl({ registries: { composer: 'https://packagist.acme.com/' } }))
        .toBe('https://packagist.acme.com')
    })
  })
})
