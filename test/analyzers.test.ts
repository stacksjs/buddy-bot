import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { actionlintAnalyzer } from '../src/analysis/analyzers/actionlint'
import { mapSeverity, parseToolJson, relativize } from '../src/analysis/analyzers/external'
import { hadolintAnalyzer } from '../src/analysis/analyzers/hadolint'
import { detectLinter, LINTER_SPECS, offsetToLine } from '../src/analysis/analyzers/linter'
import { markdownlintAnalyzer } from '../src/analysis/analyzers/markdownlint'
import { shellcheckAnalyzer } from '../src/analysis/analyzers/shellcheck'
import { syntaxAnalyzer } from '../src/analysis/analyzers/syntax'
import { BUILTIN_ANALYZERS } from '../src/analysis/engine'
import { validateConfig } from '../src/config-validation'

let root: string
let bin: string
let originalPath: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'buddy-analyzers-'))
  bin = join(root, '.fake-bin')
  await mkdir(bin, { recursive: true })
  originalPath = process.env.PATH
})

afterEach(async () => {
  process.env.PATH = originalPath
  await rm(root, { recursive: true, force: true })
})

async function write(path: string, content: string): Promise<void> {
  const full = join(root, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
}

/**
 * Put a script on PATH that prints fixed output as if it were the real tool.
 *
 * External tools are stubbed rather than installed, so the parsing is
 * exercised on every runner. A CI machine without shellcheck would otherwise
 * skip these silently — which is precisely the failure mode the analyzers
 * themselves exist to avoid.
 */
async function fakeTool(name: string, stdout: string, exitCode = 1): Promise<void> {
  const path = join(bin, name)
  await writeFile(path, `#!/bin/sh\ncat <<'BUDDY_EOF'\n${stdout}\nBUDDY_EOF\nexit ${exitCode}\n`)
  await chmod(path, 0o755)
  process.env.PATH = `${bin}:${originalPath}`
}

describe('external tool helpers', () => {
  it('success case - maps tool severities onto review severities', () => {
    expect(mapSeverity('error')).toBe('major')
    expect(mapSeverity(2)).toBe('major')
    expect(mapSeverity('warning')).toBe('minor')
    expect(mapSeverity(1)).toBe('minor')
  })

  it('success case - everything stylistic lands on nit', () => {
    // A formatting opinion must not outrank a correctness finding.
    expect(mapSeverity('style')).toBe('nit')
    expect(mapSeverity('info')).toBe('nit')
    expect(mapSeverity(undefined)).toBe('nit')
  })

  it('success case - parses JSON printed after a banner line', () => {
    // Tools print deprecation notices before their output often enough.
    expect(parseToolJson<{ a: number }>('Warning: old flag\n{"a":1}')).toEqual({ a: 1 })
  })

  it('failure case - unparseable output yields null rather than throwing', () => {
    expect(parseToolJson('not json at all')).toBeNull()
    expect(parseToolJson('{broken')).toBeNull()
  })

  it('success case - relativizes absolute and dot-prefixed paths', () => {
    expect(relativize('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(relativize('./src/a.ts', '/repo')).toBe('src/a.ts')
    expect(relativize('src/a.ts', '/repo')).toBe('src/a.ts')
  })
})

describe('shellcheck analyzer', () => {
  it('success case - maps diagnostics onto findings with the wiki link', async () => {
    await fakeTool('shellcheck', JSON.stringify([{
      file: 'deploy.sh',
      line: 12,
      level: 'error',
      code: 2086,
      message: 'Double quote to prevent globbing',
    }]))

    const findings = await shellcheckAnalyzer.run(['deploy.sh'], root)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ path: 'deploy.sh', line: 12, severity: 'major', tool: 'shellcheck' })
    // The code is what a reader searches for.
    expect(findings[0].message).toContain('SC2086')
  })

  it('success case - carries a single-line fix as a suggestion', async () => {
    await fakeTool('shellcheck', JSON.stringify([{
      file: 'a.sh',
      line: 1,
      level: 'warning',
      code: 2086,
      message: 'quote it',
      fix: { replacements: [{ replacement: 'echo "$x"' }] },
    }]))

    expect((await shellcheckAnalyzer.run(['a.sh'], root))[0].suggestion).toBe('echo "$x"')
  })

  it('failure case - a multi-part fix produces no suggestion', async () => {
    // Those describe edits at several offsets and cannot be rendered as a
    // whole-line replacement; a suggestion that applies wrongly is worse.
    await fakeTool('shellcheck', JSON.stringify([{
      file: 'a.sh',
      line: 1,
      level: 'warning',
      code: 2086,
      message: 'quote it',
      fix: { replacements: [{ replacement: '"' }, { replacement: '"' }] },
    }]))

    expect((await shellcheckAnalyzer.run(['a.sh'], root))[0].suggestion).toBeUndefined()
  })

  it('failure case - unparseable output yields no findings', async () => {
    await fakeTool('shellcheck', 'shellcheck: command failed')

    expect(await shellcheckAnalyzer.run(['a.sh'], root)).toEqual([])
  })
})

describe('hadolint analyzer', () => {
  it('success case - maps diagnostics and keeps the rule code', async () => {
    await fakeTool('hadolint', JSON.stringify([{
      file: 'Dockerfile',
      line: 3,
      code: 'DL3008',
      level: 'warning',
      message: 'Pin versions in apt get install',
    }]))

    const findings = await hadolintAnalyzer.run(['Dockerfile'], root)

    expect(findings[0]).toMatchObject({ path: 'Dockerfile', line: 3, severity: 'minor', tool: 'hadolint' })
    expect(findings[0].message).toContain('DL3008')
  })

  it('failure case - drops info and style noise', async () => {
    // A review that opens with twelve stylistic Dockerfile notes is one nobody
    // reads to the end of.
    await fakeTool('hadolint', JSON.stringify([
      { file: 'Dockerfile', line: 1, code: 'DL3006', level: 'warning', message: 'kept' },
      { file: 'Dockerfile', line: 2, code: 'DL3059', level: 'info', message: 'dropped' },
      { file: 'Dockerfile', line: 3, code: 'DL4006', level: 'style', message: 'dropped' },
    ]))

    const findings = await hadolintAnalyzer.run(['Dockerfile'], root)

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('kept')
  })

  it('edge case - a line 0 diagnostic anchors to line 1', async () => {
    await fakeTool('hadolint', JSON.stringify([
      { file: 'Dockerfile', line: 0, code: 'DL1000', level: 'error', message: 'whole file' },
    ]))

    expect((await hadolintAnalyzer.run(['Dockerfile'], root))[0].line).toBe(1)
  })
})

describe('actionlint analyzer', () => {
  it('success case - parses the oneline format', async () => {
    await fakeTool(
      'actionlint',
      '.github/workflows/ci.yml:14:9: property "foo" is not defined [expression]',
    )

    const findings = await actionlintAnalyzer.run(['.github/workflows/ci.yml'], root)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      path: '.github/workflows/ci.yml',
      line: 14,
      // actionlint has no style tier: everything it reports would misbehave.
      severity: 'major',
      tool: 'actionlint',
    })
    expect(findings[0].message).toContain('expression')
  })

  it('failure case - ignores lines that are not diagnostics', async () => {
    await fakeTool('actionlint', 'actionlint version 1.7.0\nchecking 1 file\n')

    expect(await actionlintAnalyzer.run(['.github/workflows/ci.yml'], root)).toEqual([])
  })
})

describe('markdownlint analyzer', () => {
  it('success case - keeps rules a reader would notice', async () => {
    await fakeTool('markdownlint', 'README.md:12 MD045/no-alt-text Images should have alternate text')

    const findings = await markdownlintAnalyzer.run(['README.md'], root)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ path: 'README.md', line: 12, tool: 'markdownlint' })
  })

  it('failure case - drops pure formatting conventions', async () => {
    // Those belong to a formatter, not to a reviewer's first ten comments.
    await fakeTool('markdownlint', [
      'README.md:1 MD013/line-length Line length',
      'README.md:2 MD007/ul-indent Unordered list indentation',
      'README.md:3 MD034/no-bare-urls Bare URL used',
    ].join('\n'))

    const findings = await markdownlintAnalyzer.run(['README.md'], root)

    expect(findings).toHaveLength(1)
    expect(findings[0].line).toBe(3)
  })
})

describe('syntax analyzer', () => {
  it('success case - always available, needing no tool', async () => {
    expect(await syntaxAnalyzer.available(root)).toBe(true)
  })

  it('success case - reports malformed JSON', async () => {
    await write('package.json', '{"name": "x",}')

    const findings = await syntaxAnalyzer.run(['package.json'], root)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'major', category: 'syntax' })
  })

  it('success case - reports malformed YAML', async () => {
    await write('ci.yml', 'a:\n  - b\n c: broken indent\n')

    expect(await syntaxAnalyzer.run(['ci.yml'], root)).toHaveLength(1)
  })

  it('success case - accepts valid files', async () => {
    await write('a.json', '{"ok": true}')
    await write('b.yml', 'name: ci\non: push\n')

    expect(await syntaxAnalyzer.run(['a.json', 'b.yml'], root)).toEqual([])
  })

  it('success case - allows comments in jsonc', async () => {
    await write('tsconfig.jsonc', '{\n  // a comment\n  "strict": true\n}')

    expect(await syntaxAnalyzer.run(['tsconfig.jsonc'], root)).toEqual([])
  })

  it('failure case - a slash inside a string is data, not a comment', async () => {
    // Stripping it would report a syntax error in a perfectly valid file.
    await write('a.jsonc', '{"url": "https://example.test/x"}')

    expect(await syntaxAnalyzer.run(['a.jsonc'], root)).toEqual([])
  })

  it('edge case - skips deleted and empty files', async () => {
    await write('empty.json', '   ')

    expect(await syntaxAnalyzer.run(['empty.json', 'gone.json'], root)).toEqual([])
  })

  it('edge case - anchors to a real line even with no parser position', async () => {
    await write('a.json', 'nonsense')

    expect((await syntaxAnalyzer.run(['a.json'], root))[0].line).toBeGreaterThanOrEqual(1)
  })
})

describe('linter detection', () => {
  it('success case - detects a linter by its config file', async () => {
    await write('eslint.config.ts', 'export default []')

    expect((await detectLinter(root))?.name).toBe('eslint')
  })

  it('success case - prefers pickier when both are configured', async () => {
    await write('pickier.config.ts', 'export default {}')
    await write('eslint.config.ts', 'export default []')

    expect((await detectLinter(root))?.name).toBe('pickier')
  })

  it('failure case - a dependency without a config is not a decision', async () => {
    await write('package.json', '{"devDependencies":{"eslint":"^9"}}')

    expect(await detectLinter(root)).toBeNull()
  })

  it('success case - every spec asks for machine-readable output', () => {
    for (const spec of LINTER_SPECS)
      expect(spec.args.join(' ')).toMatch(/json/)
  })
})

describe('biome offset conversion', () => {
  it('success case - converts a byte offset to a line', () => {
    expect(offsetToLine('a\nb\nc', 0)).toBe(1)
    expect(offsetToLine('a\nb\nc', 2)).toBe(2)
    expect(offsetToLine('a\nb\nc', 4)).toBe(3)
  })

  it('failure case - an out-of-range offset yields null', () => {
    // A finding on the wrong line is worse than one that was skipped: the
    // review would anchor it to unrelated code.
    expect(offsetToLine('abc', 99)).toBeNull()
    expect(offsetToLine('abc', -1)).toBeNull()
  })
})

describe('analyzer registration', () => {
  it('success case - every builtin declares patterns and a probe', () => {
    for (const analyzer of BUILTIN_ANALYZERS) {
      expect(analyzer.name).toBeTruthy()
      expect(analyzer.filePatterns.length).toBeGreaterThan(0)
      expect(typeof analyzer.available).toBe('function')
      expect(typeof analyzer.run).toBe('function')
    }
  })

  it('success case - analyzer names are unique', () => {
    const names = BUILTIN_ANALYZERS.map(analyzer => analyzer.name)

    expect(new Set(names).size).toBe(names.length)
  })

  it('success case - the analyzers cover the intended file types', () => {
    const patterns = Object.fromEntries(BUILTIN_ANALYZERS.map(a => [a.name, a.filePatterns.join(' ')]))

    expect(patterns.shellcheck).toContain('*.sh')
    expect(patterns.hadolint).toContain('Dockerfile')
    expect(patterns.markdownlint).toContain('*.md')
    expect(patterns.actionlint).toContain('.github/workflows')
    expect(patterns.linter).toContain('*.ts')
    expect(patterns.syntax).toContain('*.yml')
  })

  it('success case - an absent tool is reported, not thrown', async () => {
    // The engine turns this into a "skipped" note; a throw would lose the
    // findings of every analyzer after it.
    for (const analyzer of [shellcheckAnalyzer, hadolintAnalyzer, actionlintAnalyzer, markdownlintAnalyzer])
      expect(typeof await analyzer.available(root)).toBe('boolean')
  })
})

describe('analysis configuration', () => {
  it('success case - accepts per-analyzer switches', () => {
    expect(validateConfig({ analysis: { enabled: true, tools: { shellcheck: false } } })).toEqual([])
  })

  it('failure case - a misspelled analyzer name is an error', () => {
    // Silently leaving it enabled reads as "I turned it off" until it comments
    // on something.
    const issues = validateConfig({ analysis: { tools: { shellchek: false } } })

    expect(issues[0].path).toBe('analysis.tools.shellchek')
    expect(issues[0].message).toContain('shellcheck')
  })

  it('failure case - rejects a non-boolean switch', () => {
    expect(validateConfig({ analysis: { tools: { shellcheck: 'off' as never } } })).toHaveLength(1)
  })
})
