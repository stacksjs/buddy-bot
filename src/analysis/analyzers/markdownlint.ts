import type { ReviewFinding } from '../../review/findings'
import type { Analyzer } from '../types'
import { commandExists, relativize, runTool } from './external'

/** `file:line[:col] MDxxx/name description`, markdownlint's default shape. */
const DEFAULT_FORMAT = /^(.+?):(\d+)(?::\d+)?\s+(MD\d+)\/(\S+)\s+(.*)$/

/** Rules worth a reviewer's attention rather than a formatter's. */
const SUBSTANTIVE_RULES = new Set([
  'MD011', // reversed link syntax
  'MD034', // bare URL
  'MD039', // spaces inside link text
  'MD042', // empty link
  'MD045', // image without alt text
  'MD051', // link fragment does not exist
  'MD052', // undefined reference
  'MD053', // unused link definition
])

/**
 * markdownlint, for documentation.
 *
 * Filtered hard on purpose. Most of markdownlint's rules are formatting
 * conventions a formatter should fix silently, and a review that spends its
 * first ten comments on list indentation is one nobody reads to the end of.
 * What survives is the set that means a reader hits something broken: a dead
 * link fragment, an image with no alt text, reversed link syntax.
 */
export const markdownlintAnalyzer: Analyzer = {
  name: 'markdownlint',
  filePatterns: ['**/*.md', '**/*.markdown'],

  async available(): Promise<boolean> {
    return (await commandExists('markdownlint')) || (await commandExists('markdownlint-cli2'))
  },

  async run(files: string[], root: string): Promise<ReviewFinding[]> {
    const command = (await commandExists('markdownlint')) ? 'markdownlint' : 'markdownlint-cli2'
    const { stdout, stderr } = await runTool(command, files, root)

    const findings: ReviewFinding[] = []

    // markdownlint writes diagnostics to stderr; markdownlint-cli2 to stdout.
    for (const rawLine of `${stdout}\n${stderr}`.split('\n')) {
      const match = DEFAULT_FORMAT.exec(rawLine.trim())
      if (!match)
        continue

      const [, path, line, code, name, description] = match
      if (!SUBSTANTIVE_RULES.has(code))
        continue

      findings.push({
        path: relativize(path, root),
        line: Number(line),
        severity: 'minor',
        category: 'docs',
        message: `${description} (${code}/${name})`,
        tool: 'markdownlint',
      })
    }

    return findings
  },
}
