import type { AuditResult, Finding, Severity } from '../types'

const RESET = '\x1B[0m'
const BOLD = '\x1B[1m'
const DIM = '\x1B[2m'
const RED = '\x1B[31m'
const YELLOW = '\x1B[33m'
const BLUE = '\x1B[34m'
const GREEN = '\x1B[32m'
const GRAY = '\x1B[90m'

const SEVERITY_COLOR: Record<Severity, string> = {
  error: RED,
  warning: YELLOW,
  info: BLUE,
}

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'error',
  warning: 'warn ',
  info: 'info ',
}

export function formatPretty(result: AuditResult, opts: { color?: boolean } = {}): string {
  const color = opts.color ?? true
  const c = (code: string, text: string): string => (color ? `${code}${text}${RESET}` : text)

  if (result.workflows.length === 0)
    return c(GRAY, 'gh-audit: no workflows found under .github/workflows.')

  if (result.findings.length === 0)
    return c(GREEN, `gh-audit: ${result.workflows.length} workflow${result.workflows.length === 1 ? '' : 's'} clean.`)

  const grouped = new Map<string, Finding[]>()
  for (const f of result.findings) {
    if (!grouped.has(f.file))
      grouped.set(f.file, [])
    grouped.get(f.file)!.push(f)
  }

  const lines: string[] = []
  for (const [file, findings] of grouped) {
    lines.push(c(BOLD, file))
    for (const f of findings) {
      const sev = c(SEVERITY_COLOR[f.severity], SEVERITY_LABEL[f.severity])
      const loc = f.line !== undefined ? c(GRAY, `:${f.line}`) : ''
      const rule = c(GRAY, `(${f.ruleId})`)
      lines.push(`  ${sev}${loc}  ${f.message} ${rule}`)
      if (f.detail)
        lines.push(c(DIM, `        ${f.detail}`))
      if (f.fix)
        lines.push(c(DIM, `        fix: ${f.fix}`))
    }
    lines.push('')
  }

  const errors = result.findings.filter(f => f.severity === 'error').length
  const warnings = result.findings.filter(f => f.severity === 'warning').length
  const summary = `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} across ${grouped.size} workflow${grouped.size === 1 ? '' : 's'}`
  lines.push(c(result.failed ? RED : YELLOW, summary))

  return lines.join('\n')
}
