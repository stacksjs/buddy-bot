import type { PackageUpdate } from '../types'

/** Badge per advisory severity, so scanning the table conveys urgency. */
const SEVERITY_BADGE: Record<string, string> = {
  critical: '🔴 Critical',
  high: '🟠 High',
  moderate: '🟡 Moderate',
  low: '⚪ Low',
}

/**
 * Render the vulnerability section for updates that resolve known advisories.
 *
 * Lives in its own module because both the PR generator and the plain-text
 * body formatter need it, and importing one from the other would close a
 * cycle.
 *
 * @param updates - Updates included in the pull request
 * @returns Markdown section, or an empty string when no update resolves an advisory
 * @example
 * ```ts
 * const section = formatSecurityAdvisorySection(group.updates)
 * if (section)
 *   body += section
 * ```
 */
export function formatSecurityAdvisorySection(updates: readonly PackageUpdate[]): string {
  const affected = updates.filter(update => (update.securityAdvisories?.length ?? 0) > 0)
  if (affected.length === 0)
    return ''

  const advisoryCount = affected.reduce((sum, update) => sum + (update.securityAdvisories?.length ?? 0), 0)

  let section = `## 🔒 Security Advisories\n\n`
  section += `This PR resolves ${advisoryCount} known ${advisoryCount === 1 ? 'vulnerability' : 'vulnerabilities'} `
  section += `across ${affected.length} ${affected.length === 1 ? 'package' : 'packages'}.\n\n`
  section += `| Package | Severity | Advisory | Fixed in | Summary |\n`
  section += `|---|---|---|---|---|\n`

  for (const update of affected) {
    for (const advisory of update.securityAdvisories ?? []) {
      const severity = SEVERITY_BADGE[advisory.severity] ?? advisory.severity
      const link = advisory.url ? `[${advisory.id}](${advisory.url})` : advisory.id
      const aliases = advisory.aliases.length > 0 ? ` (${advisory.aliases.join(', ')})` : ''
      // Pipes and newlines would break the table row.
      const summary = advisory.summary.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
      section += `| \`${update.name}\` | ${severity} | ${link}${aliases} | \`${advisory.fixedVersion ?? 'n/a'}\` | ${summary} |\n`
    }
  }

  return `${section}\n`
}
