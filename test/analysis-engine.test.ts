import type { Analyzer } from '../src/analysis/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { secretsAnalyzer } from '../src/analysis/analyzers/secrets'
import { commandExists, runAnalyzers } from '../src/analysis/engine'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'buddy-analysis-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(path: string, content: string): Promise<void> {
  const full = join(root, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
}

describe('secret scanning', () => {
  it('success case - flags a committed AWS key', async () => {
    await write('src/config.ts', 'const key = "AKIAIOSFODNN7EXAMPLE"\n')

    const findings = await secretsAnalyzer.run(['src/config.ts'], root)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ path: 'src/config.ts', line: 1, severity: 'critical' })
  })

  it('success case - never echoes the credential back', async () => {
    // Quoting the match would copy the secret into the PR thread.
    await write('src/config.ts', 'const key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\n')

    const findings = await secretsAnalyzer.run(['src/config.ts'], root)

    expect(findings[0].message).not.toContain('ghp_abcdefghij')
    expect(findings[0].message).toContain('rotate it')
  })

  it('success case - reports the right line in a longer file', async () => {
    await write('src/config.ts', `const a = 1\nconst b = 2\nconst key = "AKIAIOSFODNN7EXAMPLE"\n`)

    expect((await secretsAnalyzer.run(['src/config.ts'], root))[0].line).toBe(3)
  })

  it('failure case - ignores obvious placeholders', async () => {
    await write('src/config.ts', 'const key = "AKIAIOSFODNN7EXAMPLE" // your-key-here placeholder\n')

    expect(await secretsAnalyzer.run(['src/config.ts'], root)).toHaveLength(0)
  })

  it('failure case - ignores example and fixture files', async () => {
    // A scanner that cries wolf gets muted, and a muted scanner catches nothing.
    await write('.env.example', 'AWS_KEY=AKIAIOSFODNN7EXAMPLE\n')
    await write('test/fixtures/keys.ts', 'const k = "AKIAIOSFODNN7EXAMPLE"\n')

    const findings = await secretsAnalyzer.run(['.env.example', 'test/fixtures/keys.ts'], root)

    expect(findings).toHaveLength(0)
  })

  it('failure case - does not flag ordinary code', async () => {
    await write('src/app.ts', 'export function start() { return createServer() }\n')

    expect(await secretsAnalyzer.run(['src/app.ts'], root)).toHaveLength(0)
  })

  it('edge case - skips a file that does not exist', async () => {
    expect(await secretsAnalyzer.run(['missing.ts'], root)).toEqual([])
  })

  it('success case - detects a private key block', async () => {
    await write('key.pem', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n')

    expect((await secretsAnalyzer.run(['key.pem'], root))[0].category).toBe('private-key')
  })
})

describe('analyzer selection', () => {
  const marker: Analyzer = {
    name: 'marker',
    filePatterns: ['**/*.ts'],
    available: async () => true,
    run: async files => files.map(path => ({
      path,
      line: 1,
      severity: 'minor' as const,
      category: 'test',
      message: 'ran',
      tool: 'marker',
    })),
  }

  it('success case - runs only analyzers whose file types changed', async () => {
    const result = await runAnalyzers({ files: ['docs/readme.md'], root, analyzers: [marker] })

    // A change touching no TypeScript never pays for a TypeScript analyzer.
    expect(result.ran).toEqual([])
    expect(result.findings).toEqual([])
  })

  it('success case - runs an analyzer whose patterns match', async () => {
    const result = await runAnalyzers({ files: ['src/app.ts'], root, analyzers: [marker] })

    expect(result.ran).toEqual([{ name: 'marker', findings: 1 }])
  })

  it('success case - reports an unavailable analyzer rather than dropping it', async () => {
    // Silently skipping reads as "clean" when it means "not checked".
    const unavailable: Analyzer = { ...marker, name: 'needs-tool', available: async () => false }

    const result = await runAnalyzers({ files: ['src/app.ts'], root, analyzers: [unavailable] })

    expect(result.skipped).toEqual([{ name: 'needs-tool', reason: 'tool not available on this runner' }])
  })

  it('failure case - one analyzer failing does not lose the others', async () => {
    const broken: Analyzer = {
      ...marker,
      name: 'broken',
      run: async () => {
        throw new Error('boom')
      },
    }

    const result = await runAnalyzers({ files: ['src/app.ts'], root, analyzers: [broken, marker] })

    expect(result.findings).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ name: 'broken', reason: 'boom' })
  })

  it('success case - config can disable an analyzer', async () => {
    const result = await runAnalyzers({
      files: ['src/app.ts'],
      root,
      analyzers: [marker],
      enabled: { marker: false },
    })

    expect(result.ran).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('success case - finds a committed secret through the engine', async () => {
    await write('src/leak.ts', 'const k = "AKIAIOSFODNN7EXAMPLE"\n')

    const result = await runAnalyzers({ files: ['src/leak.ts'], root })

    expect(result.findings.some(finding => finding.tool === 'secret-scan')).toBe(true)
  })
})

describe('commandExists', () => {
  it('success case - finds a command that exists', async () => {
    expect(await commandExists('git')).toBe(true)
  })

  it('failure case - reports a missing command rather than throwing', async () => {
    expect(await commandExists('definitely-not-a-real-command-xyz')).toBe(false)
  })
})
