import type { MigrationPlan } from './plan'
import type { UsageSite } from './usage'
import { summarizeUsage } from './usage'

/** What the migration actually did, as opposed to what it planned. */
export interface MigrationOutcome {
  /** Whether code was changed */
  applied: boolean
  /** Whether the repository's own verification passed afterwards */
  verified: boolean
  /** Files the migration touched */
  changedFiles: string[]
  /** Verification output, when it ran */
  verificationOutput?: string
  /** Changes the migration could not make */
  unresolved: string[]
}

const CONFIDENCE_BADGE: Record<MigrationPlan['confidence'], string> = {
  high: '🟢 high',
  medium: '🟡 medium',
  low: '🔴 low',
}

/**
 * Render the migration report appended to a major upgrade's pull request.
 *
 * States plainly what was changed, what was verified, and what was left — a
 * report that reads as finished when work remains is worse than no report,
 * because the reviewer stops looking.
 *
 * @param plan - The analysis
 * @param outcome - What the migration did, when it ran
 * @param usage - Where the package is used, for the impact summary
 */
export function renderMigrationReport(
  plan: MigrationPlan,
  outcome?: MigrationOutcome,
  usage: UsageSite[] = [],
): string {
  let body = `## 🔧 Migration report\n\n`
  body += `Upgrading \`${plan.packageName}\` from \`${plan.fromVersion}\` to \`${plan.toVersion}\`.\n\n`
  body += `**Confidence:** ${CONFIDENCE_BADGE[plan.confidence]} · **Effort:** ${'●'.repeat(plan.effort)}${'○'.repeat(5 - plan.effort)} (${plan.effort}/5)\n\n`

  if (plan.changes.length === 0) {
    body += 'No breaking changes in this span affect how this repository uses the package.\n\n'
  }
  else {
    body += `### Breaking changes affecting this repository\n\n`
    for (const change of plan.changes) {
      const version = change.version ? ` _(${change.version})_` : ''
      const marker = change.automatable ? '🔧' : '✋'
      body += `- ${marker} **${escape(change.description)}**${version}\n`
      body += `  - ${escape(change.action)}\n`
      if (change.affectedFiles.length > 0)
        body += `  - Affects: ${change.affectedFiles.map(file => `\`${file}\``).join(', ')}\n`
    }
    body += '\n🔧 applied automatically · ✋ needs a person\n\n'
  }

  if (plan.codemod)
    body += `### Codemod\n\nRan \`${escape(plan.codemod.command)}\` (${escape(plan.codemod.source)}).\n\n`

  if (outcome) {
    body += `### What was done\n\n`

    if (!outcome.applied) {
      body += 'No code changes were made — this is analysis only.\n\n'
    }
    else {
      body += `Changed ${outcome.changedFiles.length} file(s):\n\n`
      body += `${outcome.changedFiles.map(file => `- \`${file}\``).join('\n')}\n\n`

      body += outcome.verified
        ? '✅ The repository\'s own tests pass with these changes.\n\n'
        : '❌ Verification did **not** pass. Treat these changes as a starting point, not a finished migration.\n\n'

      if (outcome.verificationOutput && !outcome.verified) {
        body += `<details><summary>Verification output</summary>\n\n\`\`\`\n${
          outcome.verificationOutput.slice(0, 3000)
        }\n\`\`\`\n\n</details>\n\n`
      }
    }

    if (outcome.unresolved.length > 0) {
      body += `### Still to do\n\n`
      body += `${outcome.unresolved.map(item => `- [ ] ${escape(item)}`).join('\n')}\n\n`
    }
  }

  if (plan.risks.length > 0) {
    body += `### Risks\n\n${plan.risks.map(risk => `- ${escape(risk)}`).join('\n')}\n\n`
  }

  const impact = summarizeUsage(usage)
  if (impact.length > 0) {
    body += `<details><summary>Where this package is used (${usage.length} site(s))</summary>\n\n`
    body += `${impact.slice(0, 40).map(entry => `- \`${entry.path}\` — ${entry.count} reference(s)`).join('\n')}\n\n`
    body += '</details>\n\n'
  }

  return body
}

/** Keep report text from breaking markdown or notifying unrelated issues. */
function escape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/#(\d)/g, '#​$1')
}
