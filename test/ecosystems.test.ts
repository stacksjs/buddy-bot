import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EcosystemAdapter } from '../src/ecosystems'
import { adapterFor, adapterNamed, BUILTIN_ADAPTERS } from '../src/ecosystems'
import { scanEcosystems, stripOperators } from '../src/ecosystems/scan'
import { goAdapter } from '../src/ecosystems/go'
import { comparePep440, parsePep440, pep440UpdateType, splitConstraint } from '../src/ecosystems/pep440'
import { pythonAdapter } from '../src/ecosystems/python'
import { rubyAdapter } from '../src/ecosystems/ruby'
import { rustAdapter } from '../src/ecosystems/rust'
import { compareNumeric, detectFiles } from '../src/ecosystems/shared'
import { toOsvEcosystem } from '../src/services/security-advisories'
import { Logger } from '../src/utils/logger'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'buddy-eco-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(path: string, content: string): Promise<void> {
  const full = join(root, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
}

describe('PEP 440', () => {
  it('success case - parses the full grammar', () => {
    expect(parsePep440('1!2.3.4rc2.post1.dev3+local')).toMatchObject({
      epoch: 1,
      release: [2, 3, 4],
      pre: ['rc', 2],
      post: 1,
      dev: 3,
      local: 'local',
    })
  })

  it('success case - normalizes spelling variants', () => {
    expect(parsePep440('1.0alpha1')?.pre).toEqual(['a', 1])
    expect(parsePep440('1.0.beta2')?.pre).toEqual(['b', 2])
    expect(parsePep440('1.0-preview')?.pre).toEqual(['rc', 0])
    expect(parsePep440('v1.0')?.release).toEqual([1, 0])
  })

  it('success case - a post release is newer than the release it post-dates', () => {
    // The one that matters most: treating it as older keeps proposing a
    // downgrade for every post-release on PyPI.
    expect(comparePep440('1.0.post1', '1.0')).toBeGreaterThan(0)
  })

  it('success case - a pre-release precedes its final release', () => {
    expect(comparePep440('1.0rc1', '1.0')).toBeLessThan(0)
    expect(comparePep440('1.0a1', '1.0b1')).toBeLessThan(0)
    expect(comparePep440('1.0b1', '1.0rc1')).toBeLessThan(0)
  })

  it('success case - a dev release precedes everything at the same version', () => {
    expect(comparePep440('1.0.dev1', '1.0a1')).toBeLessThan(0)
    expect(comparePep440('1.0.dev1', '1.0')).toBeLessThan(0)
  })

  it('success case - an epoch dominates the release number', () => {
    expect(comparePep440('1!1.0', '2.0')).toBeGreaterThan(0)
  })

  it('success case - a shorter release is padded with zeros', () => {
    expect(comparePep440('1.0', '1.0.0')).toBe(0)
    expect(comparePep440('1.0', '1.0.1')).toBeLessThan(0)
  })

  it('edge case - unparseable versions get a stable order rather than a wrong one', () => {
    expect(comparePep440('garbage', 'garbage')).toBe(0)
    expect(comparePep440('a', 'b')).toBeLessThan(0)
  })

  it('success case - classifies update types', () => {
    expect(pep440UpdateType('1.0', '2.0')).toBe('major')
    expect(pep440UpdateType('1.0', '1.1')).toBe('minor')
    expect(pep440UpdateType('1.0.1', '1.0.2')).toBe('patch')
    expect(pep440UpdateType('1!1.0', '2!1.0')).toBe('major')
  })

  it('success case - splits an operator from its version', () => {
    expect(splitConstraint('~=1.4.2')).toEqual({ operator: '~=', version: '1.4.2' })
    expect(splitConstraint('>=1.2')).toEqual({ operator: '>=', version: '1.2' })
    expect(splitConstraint('1.0')).toEqual({ operator: '', version: '1.0' })
  })
})

describe('python adapter', () => {
  it('success case - parses requirements.txt', async () => {
    const deps = await pythonAdapter.parse('requirements.txt', [
      'requests>=2.28.0',
      'django==4.2  # pinned deliberately',
      'uvicorn[standard]~=0.23',
      '',
    ].join('\n'))

    expect(deps.map(d => d.name)).toEqual(['requests', 'django', 'uvicorn'])
    expect(deps[2].currentVersion).toBe('~=0.23')
  })

  it('failure case - skips directives', async () => {
    // `-e .` treated as a package would propose an update against the project.
    const deps = await pythonAdapter.parse('requirements.txt', [
      '-r base.txt',
      '-e .',
      '--index-url https://example.test',
      '# a comment',
    ].join('\n'))

    expect(deps).toEqual([])
  })

  it('failure case - a requirement with no constraint has nothing to update', async () => {
    expect(await pythonAdapter.parse('requirements.txt', 'requests\n')).toEqual([])
  })

  it('success case - parses a PEP 621 pyproject', async () => {
    const deps = await pythonAdapter.parse('pyproject.toml', [
      '[project]',
      'name = "app"',
      'dependencies = [',
      '  "requests>=2.28.0",',
      '  "pydantic~=2.0",',
      ']',
    ].join('\n'))

    expect(deps.map(d => d.name)).toEqual(['requests', 'pydantic'])
  })

  it('success case - parses a poetry pyproject', async () => {
    const deps = await pythonAdapter.parse('pyproject.toml', [
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'requests = "^2.28.0"',
      'django = { version = "4.2", extras = ["bcrypt"] }',
    ].join('\n'))

    // `python` is the interpreter marker, not a package.
    expect(deps.map(d => d.name)).toEqual(['requests', 'django'])
  })

  it('success case - preserves the operator on write', async () => {
    // `~=1.4` staying `~=` is the difference between a compatible-release pin
    // and an exact one.
    const updated = pythonAdapter.applyUpdate('requests~=2.28.0\n', {
      name: 'requests',
      currentVersion: '~=2.28.0',
      newVersion: '2.31.0',
      section: 'dependencies',
    })

    expect(updated).toBe('requests~=2.31.0\n')
  })

  it('success case - writes into a poetry table', () => {
    const updated = pythonAdapter.applyUpdate('[tool.poetry.dependencies]\nrequests = "^2.28.0"\n', {
      name: 'requests',
      currentVersion: '^2.28.0',
      newVersion: '^2.31.0',
      section: 'dependencies',
    })

    expect(updated).toContain('requests = "^2.31.0"')
  })

  it('failure case - a missing dependency leaves the file untouched', () => {
    const original = 'requests>=2.28.0\n'

    expect(pythonAdapter.applyUpdate(original, {
      name: 'flask',
      currentVersion: '>=1.0',
      newVersion: '2.0',
      section: 'dependencies',
    })).toBe(original)
  })

  it('success case - maps onto the PyPI OSV ecosystem', () => {
    expect(pythonAdapter.osvEcosystem).toBe('PyPI')
    expect(toOsvEcosystem('python')).toBe('PyPI')
  })
})

describe('rust adapter', () => {
  const CARGO = [
    '[package]',
    'name = "app"',
    '',
    '[dependencies]',
    'serde = "1.0.190"',
    'tokio = { version = "1.33", features = ["full"] }',
    'local = { path = "../local" }',
    '',
    '[dev-dependencies]',
    'criterion = "0.5"',
  ].join('\n')

  it('success case - parses plain and inline-table dependencies', async () => {
    const deps = await rustAdapter.parse('Cargo.toml', CARGO)

    expect(deps.map(d => d.name)).toEqual(['serde', 'tokio', 'criterion'])
    expect(deps[1].currentVersion).toBe('1.33')
  })

  it('failure case - a path dependency has no registry version', async () => {
    const deps = await rustAdapter.parse('Cargo.toml', CARGO)

    expect(deps.some(d => d.name === 'local')).toBe(false)
  })

  it('success case - separates dev dependencies', async () => {
    const deps = await rustAdapter.parse('Cargo.toml', CARGO)

    expect(deps.find(d => d.name === 'criterion')?.section).toBe('devDependencies')
  })

  it('success case - writes both dependency shapes', () => {
    let updated = rustAdapter.applyUpdate(CARGO, {
      name: 'serde',
      currentVersion: '1.0.190',
      newVersion: '1.0.200',
      section: 'dependencies',
    })
    updated = rustAdapter.applyUpdate(updated, {
      name: 'tokio',
      currentVersion: '1.33',
      newVersion: '1.35',
      section: 'dependencies',
    })

    expect(updated).toContain('serde = "1.0.200"')
    expect(updated).toContain('version = "1.35", features = ["full"]')
  })

  it('success case - maps onto the crates.io OSV ecosystem', () => {
    expect(toOsvEcosystem('rust')).toBe('crates.io')
  })
})

describe('go adapter', () => {
  const GOMOD = [
    'module example.com/app',
    '',
    'go 1.22',
    '',
    'require (',
    '\tgithub.com/stretchr/testify v1.8.4',
    '\tgolang.org/x/sync v0.5.0',
    '\tgithub.com/indirect/dep v1.0.0 // indirect',
    '\tgithub.com/untagged/dep v0.0.0-20230101120000-abcdef123456',
    ')',
  ].join('\n')

  it('success case - parses a require block', async () => {
    const deps = await goAdapter.parse('go.mod', GOMOD)

    expect(deps.map(d => d.name)).toEqual(['github.com/stretchr/testify', 'golang.org/x/sync'])
  })

  it('failure case - skips indirect dependencies', async () => {
    // Updating one directly is `go mod tidy`'s job, not a manifest edit's.
    const deps = await goAdapter.parse('go.mod', GOMOD)

    expect(deps.some(d => d.name.includes('indirect'))).toBe(false)
  })

  it('failure case - skips pseudo-versions', async () => {
    // These name an untagged commit; choosing a newer one is a judgement, not
    // a version bump.
    const deps = await goAdapter.parse('go.mod', GOMOD)

    expect(deps.some(d => d.name.includes('untagged'))).toBe(false)
  })

  it('success case - writes a require line', () => {
    const updated = goAdapter.applyUpdate(GOMOD, {
      name: 'golang.org/x/sync',
      currentVersion: 'v0.5.0',
      newVersion: 'v0.6.0',
      section: 'require',
    })

    expect(updated).toContain('golang.org/x/sync v0.6.0')
    expect(updated).toContain('testify v1.8.4')
  })

  it('failure case - a shorter path does not match a longer one', () => {
    // `example.com/a` must not rewrite `example.com/a/b`.
    const content = 'require (\n\texample.com/a/b v1.0.0\n)'
    const updated = goAdapter.applyUpdate(content, {
      name: 'example.com/a',
      currentVersion: 'v1.0.0',
      newVersion: 'v2.0.0',
      section: 'require',
    })

    expect(updated).toBe(content)
  })

  it('success case - maps onto the Go OSV ecosystem', () => {
    expect(toOsvEcosystem('go')).toBe('Go')
  })
})

describe('ruby adapter', () => {
  const GEMFILE = [
    "source 'https://rubygems.org'",
    '',
    "gem 'rails', '~> 7.0.4'",
    "gem 'puma', '>= 5.0'",
    "gem 'floating'",
    "# gem 'commented', '1.0'",
    "gem 'local', path: '../local'",
    '',
    'group :development, :test do',
    "  gem 'rspec', '~> 3.12'",
    'end',
  ].join('\n')

  it('success case - parses gems with constraints', async () => {
    const deps = await rubyAdapter.parse('Gemfile', GEMFILE)

    expect(deps.map(d => d.name)).toEqual(['rails', 'puma', 'rspec'])
  })

  it('failure case - a commented gem is not a dependency', async () => {
    const deps = await rubyAdapter.parse('Gemfile', GEMFILE)

    expect(deps.some(d => d.name === 'commented')).toBe(false)
  })

  it('failure case - a path gem is not from RubyGems', async () => {
    const deps = await rubyAdapter.parse('Gemfile', GEMFILE)

    expect(deps.some(d => d.name === 'local')).toBe(false)
  })

  it('failure case - a gem with no constraint has nothing to update', async () => {
    const deps = await rubyAdapter.parse('Gemfile', GEMFILE)

    expect(deps.some(d => d.name === 'floating')).toBe(false)
  })

  it('success case - records the group a gem sits in', async () => {
    const deps = await rubyAdapter.parse('Gemfile', GEMFILE)

    expect(deps.find(d => d.name === 'rspec')?.section).toContain('development')
  })

  it('success case - preserves the pessimistic operator', () => {
    // It is the whole of a Gemfile's version policy; replacing it with an
    // exact version turns a flexible constraint into a pin.
    const updated = rubyAdapter.applyUpdate(GEMFILE, {
      name: 'rails',
      currentVersion: '~> 7.0.4',
      newVersion: '7.1.0',
      section: 'dependencies',
    })

    expect(updated).toContain("gem 'rails', '~> 7.1.0'")
  })

  it('success case - maps onto the RubyGems OSV ecosystem', () => {
    expect(toOsvEcosystem('ruby')).toBe('RubyGems')
  })
})

describe('manifest discovery', () => {
  it('success case - finds manifests at several depths', async () => {
    await write('Cargo.toml', '[dependencies]')
    await write('crates/inner/Cargo.toml', '[dependencies]')

    expect(await detectFiles(root, ['Cargo.toml'])).toEqual(['Cargo.toml', 'crates/inner/Cargo.toml'])
  })

  it('failure case - never walks into vendored trees', async () => {
    // Those manifests belong to dependencies; proposing updates for them is
    // proposing to edit vendored code.
    await write('node_modules/x/Cargo.toml', '')
    await write('target/debug/Cargo.toml', '')
    await write('vendor/y/Gemfile', '')

    expect(await detectFiles(root, ['Cargo.toml', 'Gemfile'])).toEqual([])
  })

  it('success case - matches glob patterns', async () => {
    await write('requirements.txt', '')
    await write('requirements-dev.txt', '')

    const found = await detectFiles(root, ['requirements.txt', 'requirements-*.txt'])
    expect(found).toEqual(['requirements-dev.txt', 'requirements.txt'])
  })
})

describe('adapter registry', () => {
  it('success case - every adapter declares its contract', () => {
    for (const adapter of BUILTIN_ADAPTERS) {
      expect(adapter.name).toBeTruthy()
      expect(adapter.manifestPatterns.length).toBeGreaterThan(0)
      expect(typeof adapter.parse).toBe('function')
      expect(typeof adapter.latest).toBe('function')
      expect(typeof adapter.applyUpdate).toBe('function')
      expect(typeof adapter.compareVersions).toBe('function')
    }
  })

  it('success case - resolves an adapter from a manifest path', () => {
    expect(adapterFor('Cargo.toml')?.name).toBe('rust')
    expect(adapterFor('services/api/go.mod')?.name).toBe('go')
    expect(adapterFor('pyproject.toml')?.name).toBe('python')
    expect(adapterFor('Gemfile')?.name).toBe('ruby')
    expect(adapterFor('requirements-dev.txt')?.name).toBe('python')
  })

  it('failure case - an unclaimed file resolves to nothing', () => {
    expect(adapterFor('package.json')).toBeNull()
  })

  it('success case - resolves an adapter by name', () => {
    expect(adapterNamed('rust')?.name).toBe('rust')
    expect(adapterNamed('cobol')).toBeNull()
  })

  it('success case - every adapter names an OSV ecosystem', () => {
    // All four are indexed; skipping one would mean silently no advisories.
    for (const adapter of BUILTIN_ADAPTERS)
      expect(adapter.osvEcosystem).toBeTruthy()
  })
})

describe('numeric comparison', () => {
  it('success case - orders versions component-wise', () => {
    expect(compareNumeric('1.2.3', '1.10.0')).toBeLessThan(0)
    expect(compareNumeric('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareNumeric('1.0', '1.0.0')).toBe(0)
  })

  it('success case - tolerates a v prefix', () => {
    expect(compareNumeric('v1.2.0', '1.3.0')).toBeLessThan(0)
  })
})

describe('adapter-driven scan', () => {
  /** An adapter over an in-memory registry, so the scan needs no network. */
  function fakeAdapter(latest: string | null, overrides: Partial<EcosystemAdapter> = {}): EcosystemAdapter {
    return {
      name: 'rust',
      manifestPatterns: ['Cargo.toml'],
      async detect(dir) {
        return detectFiles(dir, ['Cargo.toml'])
      },
      parse: rustAdapter.parse,
      async latest() {
        return latest ? { latest } : null
      },
      applyUpdate: rustAdapter.applyUpdate,
      compareVersions: rustAdapter.compareVersions,
      updateType: rustAdapter.updateType,
      osvEcosystem: 'crates.io',
      ...overrides,
    }
  }

  it('success case - produces an update when the registry is ahead', async () => {
    await write('Cargo.toml', '[dependencies]\nserde = "1.0.190"\n')

    const result = await scanEcosystems({
      dir: root,
      adapters: [fakeAdapter('1.0.200')],
      logger: Logger.silent(),
    })

    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]).toMatchObject({
      name: 'serde',
      currentVersion: '1.0.190',
      newVersion: '1.0.200',
      updateType: 'patch',
      dependencyType: 'rust',
    })
  })

  it('failure case - proposes nothing when the registry is not ahead', async () => {
    await write('Cargo.toml', '[dependencies]\nserde = "1.0.200"\n')

    const result = await scanEcosystems({
      dir: root,
      adapters: [fakeAdapter('1.0.190')],
      logger: Logger.silent(),
    })

    expect(result.updates).toEqual([])
  })

  it('success case - honours the ignore list', async () => {
    await write('Cargo.toml', '[dependencies]\nserde = "1.0.190"\n')

    const result = await scanEcosystems({
      dir: root,
      adapters: [fakeAdapter('1.0.200')],
      ignore: ['serde'],
      logger: Logger.silent(),
    })

    expect(result.updates).toEqual([])
  })

  it('success case - counts every dependency seen, not only the outdated ones', async () => {
    await write('Cargo.toml', '[dependencies]\nserde = "1.0.190"\ntokio = "1.33"\n')

    const result = await scanEcosystems({
      dir: root,
      adapters: [fakeAdapter(null)],
      logger: Logger.silent(),
    })

    expect(result.dependenciesByEcosystem.rust).toBe(2)
  })

  it('failure case - a registry failure loses that package, not the scan', async () => {
    await write('Cargo.toml', '[dependencies]\nserde = "1.0.190"\ntokio = "1.33"\n')

    const flaky = fakeAdapter(null, {
      async latest(dependency) {
        if (dependency.name === 'serde')
          throw new Error('registry down')
        return { latest: '1.40' }
      },
    })

    const result = await scanEcosystems({ dir: root, adapters: [flaky], logger: Logger.silent() })

    expect(result.updates.map(update => update.name)).toEqual(['tokio'])
  })

  it('failure case - an unparseable manifest does not stop the others', async () => {
    await write('Cargo.toml', '[dependencies]\nserde = "1.0.190"\n')

    const broken = fakeAdapter('2.0.0', {
      async parse(): Promise<never> {
        throw new Error('bad toml')
      },
    })

    const result = await scanEcosystems({ dir: root, adapters: [broken], logger: Logger.silent() })

    expect(result.updates).toEqual([])
    expect(result.manifests[0].ecosystem).toBe('rust')
  })

  it('edge case - a repository with no manifests scans clean', async () => {
    const result = await scanEcosystems({ dir: root, logger: Logger.silent() })

    expect(result).toEqual({ updates: [], dependenciesByEcosystem: {}, manifests: [] })
  })

  it('success case - strips operators to get a comparable version', () => {
    // A constraint is not a version; the floor of the range is the
    // conventional reading of what the repository is on.
    expect(stripOperators('>=1.2.3')).toBe('1.2.3')
    expect(stripOperators('~> 7.0.4')).toBe('7.0.4')
    expect(stripOperators('^2.0')).toBe('2.0')
    expect(stripOperators('v1.0.0')).toBe('1.0.0')
  })
})
