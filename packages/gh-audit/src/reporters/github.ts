import type { AuditResult, Severity } from '../types'

const COMMAND: Record<Severity, string> = {
  error: 'error',
  warning: 'warning',
  info: 'notice',
}

/**
 * GitHub Actions workflow-command format. When this stream is captured by
 * the runner, each line surfaces as an inline annotation on the right
 * file/line of the PR.
 *
 * https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
 */
export function formatGitHub(result: AuditResult): string {
  const lines: string[] = []
  for (const f of result.findings) {
    const props = [`file=${f.file}`, `title=${f.ruleId}`]
    if (f.line !== undefined)
      props.push(`line=${f.line}`)
    const message = escape(`${f.message}${f.fix ? ` — ${f.fix}` : ''}`)
    lines.push(`::${COMMAND[f.severity]} ${props.join(',')}::${message}`)
  }
  return lines.join('\n')
}

function escape(value: string): string {
  // GitHub workflow-command escaping rules.
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
}
