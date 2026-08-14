import type { ReviewFinding } from '../../review/findings'
import type { Analyzer } from '../types'
import { commandExists, relativize, runTool } from './external'

/** `file:line:col: message [rule]`, actionlint's `-oneline` shape. */
const ONELINE = /^(.+?):(\d+):(\d+):\s*(.*?)\s*\[([\w-]+)\]$/

/**
 * actionlint, for GitHub Actions workflows.
 *
 * Complements the native workflow audit rather than duplicating it: those six
 * rules are security properties buddy-bot cares about specifically (unpinned
 * actions, `pull_request_target` misuse, script injection), while actionlint
 * type-checks expressions, `runs-on` labels, matrix shapes and shell syntax
 * inside `run:` blocks — everything that only fails once the workflow runs.
 */
export const actionlintAnalyzer: Analyzer = {
  name: 'actionlint',
  filePatterns: ['.github/workflows/*.yml', '.github/workflows/*.yaml'],

  async available(): Promise<boolean> {
    return commandExists('actionlint')
  },

  async run(files: string[], root: string): Promise<ReviewFinding[]> {
    const { stdout } = await runTool('actionlint', ['-oneline', '-no-color', ...files], root)

    const findings: ReviewFinding[] = []

    for (const rawLine of stdout.split('\n')) {
      const match = ONELINE.exec(rawLine.trim())
      if (!match)
        continue

      const [, path, line, , message, rule] = match

      findings.push({
        path: relativize(path, root),
        line: Number(line),
        // actionlint reports only real errors — it has no style tier — so
        // everything it emits would break or misbehave at runtime.
        severity: 'major',
        category: 'workflow',
        message: `${message} (${rule})`,
        tool: 'actionlint',
      })
    }

    return findings
  },
}
