import type { ReviewFinding } from '../../review/findings'
import type { Analyzer } from '../types'
import { commandExists, mapSeverity, parseToolJson, relativize, runTool } from './external'

/** One Hadolint diagnostic, as `--format json` emits it. */
interface HadolintMessage {
  file: string
  line: number
  code: string
  level: string
  message: string
}

/**
 * Hadolint, for Dockerfiles.
 *
 * Pairs with buddy-bot's Docker base-image updates: the bot proposes the new
 * tag, and this catches the pinning and layer mistakes that make that tag not
 * mean what the Dockerfile thinks it means.
 */
export const hadolintAnalyzer: Analyzer = {
  name: 'hadolint',
  filePatterns: ['**/Dockerfile', '**/Dockerfile.*', '**/*.dockerfile', '**/Containerfile'],

  async available(): Promise<boolean> {
    return commandExists('hadolint')
  },

  async run(files: string[], root: string): Promise<ReviewFinding[]> {
    // `--no-fail` keeps the exit status out of the picture; the findings are
    // read from stdout either way.
    const { stdout } = await runTool('hadolint', ['--format', 'json', '--no-fail', ...files], root)
    const messages = parseToolJson<HadolintMessage[]>(stdout)
    if (!Array.isArray(messages))
      return []

    return messages
      // `info` and `style` from a Dockerfile linter are almost entirely
      // stylistic, and a review that opens with twelve of them is one nobody
      // reads to the end of.
      .filter(message => message.level === 'error' || message.level === 'warning')
      .map(message => ({
        path: relativize(message.file, root),
        line: Math.max(1, message.line),
        severity: mapSeverity(message.level),
        category: 'docker',
        message: `${message.message} (${message.code})`,
        tool: 'hadolint',
      }))
  },
}
