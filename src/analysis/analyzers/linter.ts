import type { ReviewFinding } from '../../review/findings'
import type { Analyzer } from '../types'
import { join } from 'node:path'
import process from 'node:process'
import { mapSeverity, parseToolJson, relativize, runTool } from './external'

/** A JS/TS linter buddy-bot knows how to drive. */
interface LinterSpec {
  name: string
  /** Config files whose presence means this linter is the repository's */
  configFiles: string[]
  /** Arguments producing machine-readable output, before the file list */
  args: string[]
  /** Turn the tool's stdout into findings */
  parse: (stdout: string, root: string) => Promise<ReviewFinding[]>
}

/** ESLint's JSON reporter shape, which pickier and oxlint also emit. */
interface EslintFile {
  filePath: string
  messages?: Array<{
    line?: number
    severity?: number
    message: string
    ruleId?: string | null
  }>
}

/** Pickier's JSON reporter shape: a flat issue list, not ESLint's per-file one. */
interface PickierReport {
  issues?: Array<{
    filePath: string
    line?: number
    ruleId?: string
    message: string
    severity?: string
    help?: string
  }>
}

/** Biome's JSON reporter shape. */
interface BiomeReport {
  diagnostics?: Array<{
    location?: { path?: { file?: string } | string, span?: [number, number] }
    severity?: string
    description?: string
    message?: string | Array<{ content?: string }>
    category?: string
  }>
}

async function parseEslintJson(stdout: string, root: string): Promise<ReviewFinding[]> {
  const files = parseToolJson<EslintFile[]>(stdout)
  if (!Array.isArray(files))
    return []

  const findings: ReviewFinding[] = []

  for (const file of files) {
    for (const message of file.messages ?? []) {
      // A message with no line is a config or parse error about the file as a
      // whole. It cannot anchor to a diff line, so reporting it at line 1
      // would attach it to code that has nothing to do with it.
      if (!message.line)
        continue

      findings.push({
        path: relativize(file.filePath, root),
        line: message.line,
        severity: mapSeverity(message.severity),
        category: 'lint',
        message: message.ruleId ? `${message.message} (${message.ruleId})` : message.message,
      })
    }
  }

  return findings
}

/**
 * Convert a byte offset into a 1-based line number.
 *
 * Biome reports spans rather than lines, so the file has to be read to place a
 * diagnostic. Returns null when the offset falls outside the file, since a
 * finding on the wrong line is worse than one that was skipped — the review
 * would anchor it to unrelated code.
 */
export function offsetToLine(content: string, offset: number): number | null {
  if (offset < 0 || offset > content.length)
    return null

  let line = 1
  for (let index = 0; index < offset; index++) {
    if (content[index] === '\n')
      line++
  }

  return line
}

async function parsePickierJson(stdout: string, root: string): Promise<ReviewFinding[]> {
  const report = parseToolJson<PickierReport>(stdout)
  if (!report?.issues)
    return []

  return report.issues
    .filter(issue => Boolean(issue.line))
    .map(issue => ({
      path: relativize(issue.filePath, root),
      line: issue.line!,
      severity: mapSeverity(issue.severity),
      category: 'lint',
      // Pickier's `help` is the actionable half — it says what to do, where
      // the message only says what is wrong.
      message: [
        issue.ruleId ? `${issue.message} (${issue.ruleId})` : issue.message,
        issue.help,
      ].filter(Boolean).join(' — '),
    }))
}

async function parseBiomeJson(stdout: string, root: string): Promise<ReviewFinding[]> {
  const report = parseToolJson<BiomeReport>(stdout)
  if (!report?.diagnostics)
    return []

  const findings: ReviewFinding[] = []
  const contents = new Map<string, string | null>()

  for (const diagnostic of report.diagnostics) {
    const rawPath = typeof diagnostic.location?.path === 'string'
      ? diagnostic.location.path
      : diagnostic.location?.path?.file

    if (!rawPath || !diagnostic.location?.span)
      continue

    const path = relativize(rawPath, root)

    if (!contents.has(path)) {
      const file = Bun.file(join(root, path))
      contents.set(path, await file.exists() ? await file.text() : null)
    }

    const content = contents.get(path)
    if (content == null)
      continue

    const line = offsetToLine(content, diagnostic.location.span[0])
    if (line === null)
      continue

    const description = typeof diagnostic.message === 'string'
      ? diagnostic.message
      : diagnostic.message?.map(part => part.content ?? '').join('') || diagnostic.description

    findings.push({
      path,
      line,
      severity: mapSeverity(diagnostic.severity),
      category: 'lint',
      message: diagnostic.category ? `${description} (${diagnostic.category})` : String(description),
    })
  }

  return findings
}

/**
 * Linters buddy-bot can drive, in detection order.
 *
 * Detection is by config file rather than by dependency, because a repository
 * with a linter in `devDependencies` but no config is one where the linter is
 * a transitive artifact rather than a decision.
 */
export const LINTER_SPECS: LinterSpec[] = [
  {
    name: 'pickier',
    configFiles: ['pickier.config.ts', 'pickier.config.js', 'pickier.config.mjs'],
    args: ['--reporter', 'json'],
    parse: parsePickierJson,
  },
  {
    name: 'biome',
    configFiles: ['biome.json', 'biome.jsonc'],
    args: ['check', '--reporter=json'],
    parse: parseBiomeJson,
  },
  {
    name: 'oxlint',
    configFiles: ['.oxlintrc.json'],
    args: ['--format=json'],
    parse: parseEslintJson,
  },
  {
    name: 'eslint',
    configFiles: [
      'eslint.config.ts',
      'eslint.config.js',
      'eslint.config.mjs',
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc',
    ],
    args: ['--format', 'json'],
    parse: parseEslintJson,
  },
]

/**
 * Find the linter this repository actually uses.
 *
 * Two signals, either of which is a deliberate choice: a config file, or a
 * package script that invokes the tool. The script matters because several of
 * these linters run happily with no config at all — detecting only config
 * files would miss a repository whose `lint` script is the whole setup.
 *
 * A bare dependency is *not* a signal: a linter in `devDependencies` that
 * nothing invokes is a transitive artifact rather than a decision.
 *
 * @param root - Repository root
 * @returns The matching spec, or null when no linter is configured
 */
export async function detectLinter(root: string): Promise<LinterSpec | null> {
  for (const spec of LINTER_SPECS) {
    for (const configFile of spec.configFiles) {
      if (await Bun.file(join(root, configFile)).exists())
        return spec
    }
  }

  const scripts = await readScripts(join(root, 'package.json'))

  for (const spec of LINTER_SPECS) {
    // Word-bounded so `eslint-config-x` in a script does not count as running
    // eslint, and so `pickier` does not match `pickier-plugin`.
    const invoked = new RegExp(`(?:^|[\\s/])${spec.name}(?:$|[\\s@])`)
    if (Object.values(scripts).some(script => invoked.test(script)))
      return spec
  }

  return null
}

/** Read a package.json's scripts, tolerating absence and malformed JSON. */
async function readScripts(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path)
  if (!(await file.exists()))
    return {}

  try {
    const parsed = await file.json() as { scripts?: Record<string, string> }
    return parsed.scripts ?? {}
  }
  catch {
    return {}
  }
}

/**
 * The repository's own JS/TS linter.
 *
 * Runs whatever the repository already configured rather than imposing a
 * ruleset: a review that reports violations of rules the project does not hold
 * is noise, and one that reports violations of rules it does hold is exactly
 * the feedback a maintainer would have given.
 *
 * The linter is invoked through the package runner, so a project-local install
 * is used without requiring a global one.
 */
export const linterAnalyzer: Analyzer = {
  name: 'linter',
  filePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],

  async available(root: string): Promise<boolean> {
    // Availability here is about repository content, not an installed binary:
    // the linter is whatever this repository configured, run through the
    // package runner so a project-local install is enough.
    return (await detectLinter(root || process.cwd())) !== null
  },

  async run(files: string[], root: string): Promise<ReviewFinding[]> {
    const spec = await detectLinter(root)
    if (!spec)
      return []

    const { stdout } = await runTool('bunx', ['--bun', spec.name, ...spec.args, ...files], root)

    const findings = await spec.parse(stdout, root)
    return findings.map(finding => ({ ...finding, tool: spec.name }))
  },
}
