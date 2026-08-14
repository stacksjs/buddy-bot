import type { ReviewFinding } from '../../review/findings'
import type { Analyzer } from '../types'
import { commandExists, mapSeverity, parseToolJson, relativize, runTool } from './external'

/** One ShellCheck diagnostic, as `--format=json` emits it. */
interface ShellCheckComment {
  file: string
  line: number
  level: string
  code: number
  message: string
  fix?: { replacements?: Array<{ replacement: string }> }
}

/**
 * ShellCheck, for shell scripts.
 *
 * Shell is where a subtly wrong quote becomes a command injection, and it is
 * the one language in most repositories with no compiler and usually no tests.
 */
export const shellcheckAnalyzer: Analyzer = {
  name: 'shellcheck',
  filePatterns: ['**/*.sh', '**/*.bash', '**/*.ksh'],

  async available(): Promise<boolean> {
    return commandExists('shellcheck')
  },

  async run(files: string[], root: string): Promise<ReviewFinding[]> {
    const { stdout } = await runTool('shellcheck', ['--format=json', '--severity=warning', ...files], root)
    const comments = parseToolJson<ShellCheckComment[]>(stdout)
    if (!Array.isArray(comments))
      return []

    return comments.map(comment => ({
      path: relativize(comment.file, root),
      line: comment.line,
      severity: mapSeverity(comment.level),
      category: 'shell',
      // The code is what a reader searches for; the wiki page is the real
      // explanation and shellcheck's own message is only a summary of it.
      message: `${comment.message} (SC${comment.code}: https://www.shellcheck.net/wiki/SC${comment.code})`,
      tool: 'shellcheck',
      ...suggestionOf(comment),
    }))
  },
}

/** A single-line replacement, when ShellCheck offers exactly one. */
function suggestionOf(comment: ShellCheckComment): { suggestion?: string } {
  const replacements = comment.fix?.replacements
  // Multi-part fixes describe edits at several offsets on the line, which
  // cannot be rendered as a whole-line suggestion without reconstructing the
  // line — and a suggestion that applies wrongly is worse than none.
  if (replacements?.length !== 1)
    return {}

  return { suggestion: replacements[0].replacement }
}
