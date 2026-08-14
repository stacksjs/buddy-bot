import type { ReviewFinding, ReviewResult } from './findings'

/** Which local changes to review. */
export type DiffMode = 'working' | 'staged' | 'branch'

/** How to render a local review. */
export type ReviewFormat = 'pretty' | 'json' | 'github' | 'agent'

/** Every format the CLI accepts, for validation and help text. */
export const REVIEW_FORMATS: ReviewFormat[] = ['pretty', 'json', 'github', 'agent']

/**
 * Git arguments producing the diff for a mode.
 *
 * `working` deliberately includes staged changes too (`git diff HEAD`): a
 * pre-commit review that ignored what you just staged would miss the very
 * changes you are about to commit.
 *
 * @param mode - Which changes to collect
 * @param base - Base ref, used by `branch`
 * @returns Arguments to pass to `git`
 */
export function diffArgsFor(mode: DiffMode, base: string): string[] {
  switch (mode) {
    case 'staged':
      return ['diff', '--no-color', '--cached']
    case 'branch':
      // Three-dot: what this branch added, not what the base moved on to.
      return ['diff', '--no-color', `${base}...HEAD`]
    case 'working':
      return ['diff', '--no-color', 'HEAD']
  }
}

/**
 * Collect a local diff.
 *
 * @param mode - Which changes to review
 * @param base - Base ref for branch mode
 * @param cwd - Repository directory
 * @returns The unified diff, empty when nothing changed
 * @throws {Error} When git fails, with git's own message
 */
export async function collectLocalDiff(mode: DiffMode, base: string, cwd?: string): Promise<string> {
  const proc = Bun.spawn(['git', ...diffArgsFor(mode, base)], { cwd, stdout: 'pipe', stderr: 'pipe' })

  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git diff failed: ${stderr.trim() || `exit ${exitCode}`}`)
  }

  return stdout
}

const SEVERITY_ICON: Record<ReviewFinding['severity'], string> = {
  critical: '🛑',
  major: '⚠️',
  minor: '💡',
  nit: '🔹',
}

/**
 * Render a review for a terminal.
 *
 * Grouped by file rather than by severity, because that is the order the
 * reader will open them in.
 */
export function formatPretty(result: ReviewResult): string {
  const lines: string[] = ['', result.summary, '']

  if (result.findings.length === 0) {
    lines.push('✅ Nothing to report.')
    // Still reported: "clean" and "not checked" are different answers, and a
    // review that omitted a file has given the second one.
    if (result.omittedFiles.length > 0)
      lines.push(`Not reviewed: ${result.omittedFiles.join(', ')}`)
    return `${lines.join('\n')}\n`
  }

  const byFile = new Map<string, ReviewFinding[]>()
  for (const finding of result.findings) {
    const existing = byFile.get(finding.path)
    if (existing)
      existing.push(finding)
    else
      byFile.set(finding.path, [finding])
  }

  for (const [path, findings] of byFile) {
    lines.push(`${path}`)
    for (const finding of [...findings].sort((a, b) => a.line - b.line)) {
      const tool = finding.tool ? ` [${finding.tool}]` : ''
      lines.push(`  ${SEVERITY_ICON[finding.severity]} ${finding.line}: ${finding.message}${tool}`)
      if (finding.suggestion)
        lines.push(`     suggested: ${finding.suggestion}`)
    }
    lines.push('')
  }

  const counts = countBySeverity(result.findings)
  lines.push(`${result.findings.length} finding(s): ${
    Object.entries(counts).map(([severity, count]) => `${count} ${severity}`).join(', ')
  }`)

  if (result.omittedFiles.length > 0)
    lines.push(`Not reviewed: ${result.omittedFiles.join(', ')}`)

  return `${lines.join('\n')}\n`
}

/**
 * Render a review as GitHub Actions workflow commands.
 *
 * Actions renders these as annotations on the diff, so a local review and a CI
 * review put the comment in the same place.
 */
export function formatGithub(result: ReviewResult): string {
  return result.findings
    .map((finding) => {
      const level = finding.severity === 'critical' || finding.severity === 'major' ? 'error' : 'warning'
      // Newlines and the characters that delimit a workflow command have to be
      // escaped or the annotation is truncated at the first one.
      const message = finding.message
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A')
      return `::${level} file=${finding.path},line=${finding.line}::${message}`
    })
    .join('\n')
}

/**
 * Render a review as a prompt block for a coding agent.
 *
 * The point is `buddy-bot review --format agent | claude`: the output has to
 * be an instruction, not a report, and it has to carry enough location
 * information for the agent to find each site without re-deriving it.
 */
export function formatAgent(result: ReviewResult): string {
  if (result.findings.length === 0)
    return 'A code review of the current changes found nothing to fix.\n'

  const lines = [
    'Fix the code review findings below in this repository.',
    '',
    'Rules:',
    '- Change only what a finding asks for. Do not refactor surrounding code.',
    '- If you disagree with a finding, say so and leave the code alone rather than',
    '  making a change you do not believe in.',
    '- Run the repository\'s tests when you are done.',
    '',
    `Context: ${result.summary}`,
    '',
    'Findings:',
    '',
  ]

  for (const finding of result.findings) {
    lines.push(`${finding.path}:${finding.line} (${finding.severity})`)
    lines.push(`  ${finding.message}`)
    if (finding.suggestion)
      lines.push(`  Suggested replacement for that line:\n    ${finding.suggestion}`)
    lines.push('')
  }

  return lines.join('\n')
}

/** Count findings per severity, omitting severities with none. */
export function countBySeverity(findings: ReviewFinding[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const finding of findings)
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1
  return counts
}

/**
 * Render a review in the requested format.
 *
 * @param result - The review to render
 * @param format - Output format
 * @returns The rendered review
 */
export function formatReview(result: ReviewResult, format: ReviewFormat): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(result, null, 2)}\n`
    case 'github':
      return `${formatGithub(result)}\n`
    case 'agent':
      return formatAgent(result)
    case 'pretty':
      return formatPretty(result)
  }
}

/**
 * Apply a finding's suggestion to a file in the working tree.
 *
 * Replaces exactly the flagged line. A suggestion spanning several lines is
 * written as several lines at that position, which is what a reviewer applying
 * it by hand would do.
 *
 * @param content - Current file content
 * @param line - 1-based line to replace
 * @param suggestion - Replacement text
 * @returns The new content, or null when the line is out of range
 */
export function applySuggestion(content: string, line: number, suggestion: string): string | null {
  const lines = content.split('\n')
  // Out of range means the file moved under us since the review; writing
  // anyway would corrupt an unrelated line.
  if (line < 1 || line > lines.length)
    return null

  lines.splice(line - 1, 1, ...suggestion.split('\n'))
  return lines.join('\n')
}

/**
 * Whether a review's findings should fail a command.
 *
 * @param findings - The review's findings
 * @param threshold - Lowest severity that counts as a failure
 */
export function shouldFail(findings: ReviewFinding[], threshold: ReviewFinding['severity'] = 'major'): boolean {
  const order: ReviewFinding['severity'][] = ['critical', 'major', 'minor', 'nit']
  const limit = order.indexOf(threshold)

  return findings.some(finding => order.indexOf(finding.severity) <= limit)
}
