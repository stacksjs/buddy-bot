import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyCatalogUpdates, scanCatalogs } from '../src/scanner/catalog-scan'
import {
  bumpEngineConstraint,
  collectResolutionPins,
  extractEngines,
  KNOWN_ENGINES,
  pinBlocksUpdate,
  resolveEngineVersion,
} from '../src/scanner/package-json-extras'
import {
  applyCatalogUpdate,
  isCatalogReference,
  parseWorkspaceCatalogs,
  resolveCatalogReference,
} from '../src/scanner/workspace-catalog'
import { Logger } from '../src/utils/logger'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'buddy-js-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const WORKSPACE = [
  'packages:',
  "  - 'packages/*'",
  '',
  'catalog:',
  "  react: ^18.2.0",
  "  lodash: ^4.17.20   # deliberately held",
  '',
  'catalogs:',
  '  react17:',
  "    react: ^17.0.2",
  '  tooling:',
  "    typescript: ^5.3.0",
].join('\n')

describe('workspace catalogs', () => {
  it('success case - parses the default and named catalogs', () => {
    const { entries, hasCatalogs } = parseWorkspaceCatalogs(WORKSPACE)

    expect(hasCatalogs).toBe(true)
    expect(entries).toContainEqual({ name: 'react', version: '^18.2.0', catalog: 'default' })
    expect(entries).toContainEqual({ name: 'react', version: '^17.0.2', catalog: 'react17' })
    expect(entries).toContainEqual({ name: 'typescript', version: '^5.3.0', catalog: 'tooling' })
  })

  it('failure case - a workspace with no catalogs declares none', () => {
    expect(parseWorkspaceCatalogs("packages:\n  - 'packages/*'\n")).toEqual({
      entries: [],
      hasCatalogs: false,
    })
  })

  it('edge case - malformed YAML yields nothing rather than throwing', () => {
    expect(parseWorkspaceCatalogs('catalog:\n  - [broken').hasCatalogs).toBe(false)
  })

  it('success case - resolves a catalog reference', () => {
    const { entries } = parseWorkspaceCatalogs(WORKSPACE)

    expect(resolveCatalogReference('catalog:', entries, 'react')).toBe('^18.2.0')
    expect(resolveCatalogReference('catalog:default', entries, 'react')).toBe('^18.2.0')
    expect(resolveCatalogReference('catalog:react17', entries, 'react')).toBe('^17.0.2')
  })

  it('failure case - a plain version is not a catalog reference', () => {
    expect(resolveCatalogReference('^18.0.0', [], 'react')).toBeNull()
    expect(isCatalogReference('^18.0.0')).toBe(false)
    expect(isCatalogReference('catalog:')).toBe(true)
  })

  it('failure case - a reference to a catalog with no such entry resolves to nothing', () => {
    const { entries } = parseWorkspaceCatalogs(WORKSPACE)

    expect(resolveCatalogReference('catalog:tooling', entries, 'react')).toBeNull()
  })

  it('success case - writes into the right catalog block', () => {
    // Two catalogs naming the same package at different versions must each
    // keep their own.
    const updated = applyCatalogUpdate(
      WORKSPACE,
      { name: 'react', version: '^17.0.2', catalog: 'react17' },
      '^17.0.3',
    )

    expect(updated).toContain('react: ^17.0.3')
    expect(updated).toContain('react: ^18.2.0')
  })

  it('success case - preserves trailing comments', () => {
    const updated = applyCatalogUpdate(
      WORKSPACE,
      { name: 'lodash', version: '^4.17.20', catalog: 'default' },
      '^4.17.21',
    )

    expect(updated).toContain('lodash: ^4.17.21   # deliberately held')
  })

  it('failure case - an entry that is not there leaves the file untouched', () => {
    expect(applyCatalogUpdate(WORKSPACE, { name: 'vue', version: '^3.0.0', catalog: 'default' }, '^3.4.0'))
      .toBe(WORKSPACE)
  })

  it('failure case - a wrong current version does not match', () => {
    // Guards against writing over an entry that already moved.
    expect(applyCatalogUpdate(WORKSPACE, { name: 'react', version: '^18.0.0', catalog: 'default' }, '^18.3.0'))
      .toBe(WORKSPACE)
  })
})

describe('catalog scanning', () => {
  it('success case - proposes updates against the workspace file', async () => {
    await writeFile(join(root, 'pnpm-workspace.yaml'), WORKSPACE)

    const result = await scanCatalogs(root, async name => (name === 'react' ? '18.3.1' : null), {
      logger: Logger.silent(),
    })

    const reactUpdates = result.updates.filter(update => update.name === 'react')
    expect(reactUpdates).toHaveLength(2)
    expect(reactUpdates[0].file).toBe('pnpm-workspace.yaml')
    expect(reactUpdates[0].dependencyType).toBe('catalog')
  })

  it('success case - preserves the declared operator', async () => {
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'catalog:\n  react: ^18.2.0\n')

    const result = await scanCatalogs(root, async () => '18.3.1', { logger: Logger.silent() })

    expect(result.updates[0].newVersion).toBe('^18.3.1')
  })

  it('success case - records which catalog an update belongs to', async () => {
    await writeFile(join(root, 'pnpm-workspace.yaml'), WORKSPACE)

    const result = await scanCatalogs(root, async () => '18.3.1', { logger: Logger.silent() })

    expect(result.updates.map(update => update.resolved?.catalog)).toContain('react17')
  })

  it('failure case - an already-current entry is not an update', async () => {
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'catalog:\n  react: ^18.3.1\n')

    const result = await scanCatalogs(root, async () => '18.3.1', { logger: Logger.silent() })

    expect(result.updates).toEqual([])
  })

  it('success case - honours the ignore list', async () => {
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'catalog:\n  react: ^18.2.0\n')

    const result = await scanCatalogs(root, async () => '18.3.1', {
      ignore: ['react'],
      logger: Logger.silent(),
    })

    expect(result.updates).toEqual([])
  })

  it('edge case - no workspace file scans clean', async () => {
    expect(await scanCatalogs(root, async () => '1.0.0', { logger: Logger.silent() }))
      .toEqual({ updates: [], entries: [] })
  })

  it('success case - applies updates back to the file', async () => {
    await writeFile(join(root, 'pnpm-workspace.yaml'), WORKSPACE)

    const result = await scanCatalogs(root, async name => (name === 'typescript' ? '5.4.0' : null), {
      logger: Logger.silent(),
    })

    expect(applyCatalogUpdates(WORKSPACE, result.updates)).toContain('typescript: ^5.4.0')
  })
})

describe('engines', () => {
  it('success case - extracts known engines', () => {
    const deps = extractEngines({ node: '>=20', bun: '>=1.0' }, 'package.json')

    expect(deps.map(d => d.name)).toEqual(['node', 'bun'])
    expect(deps[0]).toMatchObject({ currentVersion: '>=20', type: 'engines' })
  })

  it('failure case - an unknown engine has no registry to ask', () => {
    // Guessing at one would resolve versions for an unrelated package.
    expect(extractEngines({ vscode: '^1.80.0' }, 'package.json')).toEqual([])
  })

  it('edge case - a missing or malformed engines field yields nothing', () => {
    expect(extractEngines(undefined, 'package.json')).toEqual([])
    expect(extractEngines(['node'], 'package.json')).toEqual([])
    expect(extractEngines({ node: '' }, 'package.json')).toEqual([])
  })

  it('success case - resolves a version through the right lookup', async () => {
    const calls: string[] = []

    const version = await resolveEngineVersion('node', {
      npm: async (name) => {
        calls.push(`npm:${name}`)
        return null
      },
      github: async (repo) => {
        calls.push(`github:${repo}`)
        return 'v22.3.0'
      },
    })

    // Node publishes releases on GitHub, not to the npm registry.
    expect(calls).toEqual(['github:nodejs/node'])
    expect(version).toBe('22.3.0')
  })

  it('success case - npm-published runtimes use the registry', async () => {
    const version = await resolveEngineVersion('pnpm', {
      npm: async () => '9.1.0',
      github: async () => null,
    })

    expect(version).toBe('9.1.0')
  })

  it('success case - preserves the operator and the precision', () => {
    // Rewriting `>=20` to `20.11.1` turns "20 or newer" into "only 20.11.1",
    // which breaks every contributor on a different patch release.
    expect(bumpEngineConstraint('>=20', '22.3.0')).toBe('>=22')
    expect(bumpEngineConstraint('>=20.5', '22.3.0')).toBe('>=22.3')
    // Lexicographic: 22.3 follows 20.5 even though 3 < 5.
    expect(bumpEngineConstraint('^18.0.0', '20.1.2')).toBe('^20.1.2')
  })

  it('failure case - a constraint that already admits the version is left alone', () => {
    expect(bumpEngineConstraint('>=20', '20.11.1')).toBeNull()
    expect(bumpEngineConstraint('>=22', '20.0.0')).toBeNull()
  })

  it('failure case - a range expression is not bumped', () => {
    // `>=18 <21` is a deliberate window; widening it is a decision.
    expect(bumpEngineConstraint('>=18 <21', '22.0.0')).toBeNull()
    expect(bumpEngineConstraint('*', '22.0.0')).toBeNull()
  })

  it('success case - every known engine names a source', () => {
    for (const [name, spec] of Object.entries(KNOWN_ENGINES)) {
      expect(spec.source).toBeTruthy()
      expect(['npm', 'github']).toContain(spec.registry)
      expect(name).toBeTruthy()
    }
  })
})

describe('overrides and resolutions', () => {
  it('success case - collects pins from every field', () => {
    const pins = collectResolutionPins({
      overrides: { lodash: '4.17.21' },
      resolutions: { minimist: '1.2.8' },
      pnpm: { overrides: { semver: '7.5.4' } },
    })

    expect(pins).toContainEqual({ name: 'lodash', version: '4.17.21', field: 'overrides' })
    expect(pins).toContainEqual({ name: 'minimist', version: '1.2.8', field: 'resolutions' })
    expect(pins).toContainEqual({ name: 'semver', version: '7.5.4', field: 'pnpm.overrides' })
  })

  it('success case - walks npm nested override form', () => {
    const pins = collectResolutionPins({
      overrides: { foo: { '.': '1.0.0', 'bar': '2.0.0' } },
    })

    expect(pins).toContainEqual({ name: 'foo', version: '1.0.0', field: 'overrides' })
    expect(pins).toContainEqual({ name: 'bar', version: '2.0.0', field: 'overrides' })
  })

  it('edge case - a manifest with no overrides has no pins', () => {
    expect(collectResolutionPins({ dependencies: { react: '^18' } })).toEqual([])
    expect(collectResolutionPins(null)).toEqual([])
  })

  it('success case - an exact pin blocks a different version', () => {
    // The PR would change package.json, pass CI, merge, and install exactly
    // the same tree — worse than no PR, because it looks like progress.
    expect(pinBlocksUpdate({ name: 'lodash', version: '4.17.21', field: 'overrides' }, '4.17.22'))
      .toBe(true)
  })

  it('failure case - a range that already admits the version does not block it', () => {
    expect(pinBlocksUpdate({ name: 'lodash', version: '^4.17.0', field: 'overrides' }, '4.17.22'))
      .toBe(false)
  })

  it('success case - a range that excludes the version blocks it', () => {
    expect(pinBlocksUpdate({ name: 'lodash', version: '^4.16.0', field: 'overrides' }, '5.0.0'))
      .toBe(true)
  })

  it('edge case - an exact pin matching the version does not block it', () => {
    expect(pinBlocksUpdate({ name: 'lodash', version: '4.17.22', field: 'overrides' }, '4.17.22'))
      .toBe(false)
  })

  it('edge case - an unparseable constraint is reported rather than assumed harmless', () => {
    expect(pinBlocksUpdate({ name: 'x', version: 'npm:other@1', field: 'overrides' }, '2.0.0'))
      .toBe(true)
  })
})
