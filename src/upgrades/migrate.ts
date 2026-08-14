import type { AiClient } from '../ai/types'
import type { PackageUpdate } from '../types'
import type { Logger } from '../utils/logger'
import type { MigrationConfidence, MigrationPlan } from './plan'
import type { MigrationOutcome } from './report'
import type { UsageSite } from './usage'
import { implementMode } from '../agent/modes'
import { runAgent } from '../agent/runner'
import { getDefaultLogger } from '../utils/logger'
import { buildAnalysisPrompt, MIGRATION_PLAN_SCHEMA, normalizePlan, shouldOpenAsDraft } from './plan'
import { renderMigrationReport } from './report'
import { findUsageSites } from './usage'

/** What a major-upgrade attempt produced. */
export interface UpgradeResult {
  plan: MigrationPlan | null
  outcome?: MigrationOutcome
  /** Report to append to the pull request body */
  report: string
  /** Whether the pull request should open as a draft */
  draft: boolean
  /** Why the attempt ended where it did */
  status: 'analysis-only' | 'migrated' | 'migration-failed' | 'skipped'
}

/** Inputs to a major-upgrade attempt. */
export interface UpgradeOptions {
  update: PackageUpdate
  /** Release notes across the whole version span */
  releaseNotes: string
  /** Repository-relative paths to search for usage */
  files: string[]
  workspace: string
  baseBranch: string
  branch?: string
  /** Client for analysis and migration; absent means today's plain-PR behaviour */
  ai?: AiClient | null
  /** Analyse without changing code (default: true) */
  autoMigrate?: boolean
  /** Open as draft below this confidence (default: high) */
  draftBelowConfidence?: MigrationConfidence
  logger?: Logger
}

/**
 * Analyse a major upgrade, and migrate the repository when asked to.
 *
 * The fallback ladder is the design: with no AI configured this returns
 * nothing and the caller opens the ordinary major-update pull request it
 * always did; with AI it adds an analysis; with `autoMigrate` it attempts the
 * change and reports honestly whether verification passed. A migration is
 * never presented as finished when it is not — a broken PR that looks ready
 * costs more than an obviously unfinished one.
 *
 * @param options - The update, its release notes and repository context
 * @returns The plan, what was done, and the report to attach
 * @example
 * ```ts
 * const result = await attemptMajorUpgrade({ update, releaseNotes, files, workspace, baseBranch, ai })
 * pr.body += result.report
 * ```
 */
export async function attemptMajorUpgrade(options: UpgradeOptions): Promise<UpgradeResult> {
  const logger = options.logger ?? getDefaultLogger()
  const { update } = options

  if (!options.ai) {
    // No AI configured: today's behaviour exactly, no report, no draft.
    logger.debug('🔧 Major upgrade analysis skipped: no AI provider configured')
    return { plan: null, report: '', draft: false, status: 'skipped' }
  }

  const usage = await findUsageSites(update.name, options.files, options.workspace)
  logger.info(`🔧 Analysing ${update.name} ${update.currentVersion} → ${update.newVersion} (${usage.length} usage site(s))`)

  const knownFiles = [...new Set(usage.map(site => site.path))]

  const response = await options.ai.complete({
    system: 'You analyse major dependency upgrades. Report only what affects the repository '
      + 'you are shown, and state confidence honestly — a low-confidence plan is more useful '
      + 'than a wrong high-confidence one.',
    messages: [{
      role: 'user',
      content: buildAnalysisPrompt({
        packageName: update.name,
        fromVersion: update.currentVersion,
        toVersion: update.newVersion,
        releaseNotes: options.releaseNotes,
        usage,
      }),
    }],
    jsonSchema: MIGRATION_PLAN_SCHEMA,
  })

  const plan = normalizePlan(response.json, {
    packageName: update.name,
    fromVersion: update.currentVersion,
    toVersion: update.newVersion,
    knownFiles,
  })

  const draft = shouldOpenAsDraft(plan, options.draftBelowConfidence ?? 'high')

  // Analysis-only is the default: changing code is opt-in, because a wrong
  // migration is far more expensive than a missing one.
  if (options.autoMigrate !== true) {
    return {
      plan,
      report: renderMigrationReport(plan, undefined, usage),
      draft,
      status: 'analysis-only',
    }
  }

  if (plan.changes.length === 0) {
    logger.info('🔧 No breaking changes affect this repository; nothing to migrate')
    return { plan, report: renderMigrationReport(plan, undefined, usage), draft: false, status: 'analysis-only' }
  }

  const result = await runAgent(options.ai, {
    mode: implementMode,
    task: buildMigrationTask(plan),
    context: {
      workspace: options.workspace,
      baseBranch: options.baseBranch,
      ...(options.branch ? { branch: options.branch } : {}),
    },
    logger,
  })

  const verified = result.stopReason === 'completed'
  const outcome: MigrationOutcome = {
    applied: result.toolCalls > 0,
    verified,
    changedFiles: knownFiles,
    unresolved: verified ? [] : plan.changes.filter(change => !change.automatable).map(change => change.action),
    ...(verified ? {} : { verificationOutput: result.output }),
  }

  return {
    plan,
    outcome,
    report: renderMigrationReport(plan, outcome, usage),
    // An unverified migration always opens as a draft, whatever the plan's
    // confidence said before the work was attempted.
    draft: draft || !verified,
    status: verified ? 'migrated' : 'migration-failed',
  }
}

/** Turn a plan into the agent's task. */
function buildMigrationTask(plan: MigrationPlan): string {
  const steps = plan.changes.map((change, index) =>
    `${index + 1}. ${change.description}\n   Action: ${change.action}\n   Files: ${
      change.affectedFiles.join(', ') || '(none identified)'
    }`,
  )

  return [
    `Migrate this repository for the ${plan.packageName} upgrade from ${plan.fromVersion} to ${plan.toVersion}.`,
    '',
    plan.codemod
      ? `An official codemod exists. Run it first:\n  ${plan.codemod.command}\n`
      : '',
    'Breaking changes to address:',
    '',
    steps.join('\n\n'),
    '',
    'Change only what these require. A migration commit that also refactors',
    'surrounding code is one a reviewer has to disentangle.',
    '',
    'Run the repository\'s tests when you are done. If they fail and you cannot fix it,',
    'stop and report what failed — do not report success you have not verified.',
  ].filter(Boolean).join('\n')
}
