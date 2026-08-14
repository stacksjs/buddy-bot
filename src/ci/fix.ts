import type { AiClient } from '../ai/types'
import type { Logger } from '../utils/logger'
import type { ClassifiedFailure } from './classify'
import { runAgent } from '../agent/runner'
import { fixCiMode } from '../agent/modes'
import { getDefaultLogger } from '../utils/logger'
import { classifyFailure, describeFailure } from './classify'

/** What a fix attempt concluded. */
export interface FixOutcome {
  /** How the failure was classified */
  failure: ClassifiedFailure
  /** What action was taken */
  action: 'mechanical-fix' | 'retry' | 'agent-fix' | 'reported' | 'skipped'
  /** Whether the failure looks resolved */
  fixed: boolean
  /** Comment body explaining the outcome, ready to post */
  report: string
}

/** Inputs to a fix attempt. */
export interface FixOptions {
  /** Captured log from the failing job */
  log: string
  /** Whether the same failure occurs on the base branch */
  failsOnBase?: boolean
  /** Repository workspace */
  workspace: string
  /** Branch under repair */
  branch?: string
  baseBranch: string
  /** How many attempts have already been made on this pull request */
  priorAttempts?: number
  /** Maximum attempts before giving up */
  maxAttempts?: number
  /** Client for agent-driven repair; absent means analysis only */
  ai?: AiClient | null
  /** Run the mechanical repair for a stale lock file */
  regenerateLockfile?: () => Promise<boolean>
  logger?: Logger
}

/**
 * Diagnose a failing CI run and repair it when the fix is clear.
 *
 * Ordered cheapest-first: a failure that also happens on the base branch is
 * not this change's to fix, a known-mechanical failure is fixed without a
 * model, and only what remains reaches the agent. This is also why fix-ci is
 * useful with no AI configured at all.
 *
 * @param options - Log, repository context and repair hooks
 * @returns What was done and a report ready to post
 * @example
 * ```ts
 * const outcome = await attemptFix({ log, workspace, baseBranch: 'main' })
 * await provider.createComment(pr, outcome.report)
 * ```
 */
export async function attemptFix(options: FixOptions): Promise<FixOutcome> {
  const logger = options.logger ?? getDefaultLogger()
  const failure = classifyFailure(options.log)
  const maxAttempts = options.maxAttempts ?? 3

  logger.info(`🩺 CI failure classified as ${failure.kind}`)

  // A failure that reproduces on the base branch is pre-existing. Patching
  // around it here would attribute someone else's breakage to this change.
  if (options.failsOnBase) {
    return {
      failure,
      action: 'skipped',
      fixed: false,
      report: report(failure, 'This failure also occurs on the base branch, so it is not caused by this change. '
        + 'Fixing it here would only mask it.'),
    }
  }

  if ((options.priorAttempts ?? 0) >= maxAttempts) {
    return {
      failure,
      action: 'skipped',
      fixed: false,
      report: report(failure, `Already attempted ${options.priorAttempts} time(s); stopping rather than looping.`),
    }
  }

  if (failure.kind === 'lockfile-drift' && options.regenerateLockfile) {
    logger.info('🔧 Regenerating the lock file')
    const regenerated = await options.regenerateLockfile()

    return {
      failure,
      action: 'mechanical-fix',
      fixed: regenerated,
      report: report(
        failure,
        regenerated
          ? 'Regenerated the lock file and pushed the result. No model was needed.'
          : 'Tried to regenerate the lock file, but the install did not succeed.',
      ),
    }
  }

  if (failure.kind === 'flake') {
    return {
      failure,
      action: 'retry',
      fixed: false,
      report: report(failure, 'This looks transient. Re-running the failed job is likely to clear it.'),
    }
  }

  if (!options.ai) {
    return {
      failure,
      action: 'reported',
      fixed: false,
      report: report(failure, 'No AI provider is configured, so this needs a human. '
        + 'See https://buddy-bot.sh/ai/providers to enable automatic repair.'),
    }
  }

  const result = await runAgent(options.ai, {
    mode: fixCiMode,
    task: [
      'A CI job on this branch is failing. Diagnose the root cause and fix it if the fix is clear.',
      '',
      `Classification: ${failure.kind} — ${describeFailure(failure)}`,
      '',
      'Relevant log lines:',
      failure.evidence.join('\n'),
      '',
      'Verify your fix by running the project\'s tests or build before reporting it done.',
      'If the fix is not clear, explain what you found rather than guessing.',
    ].join('\n'),
    context: {
      workspace: options.workspace,
      baseBranch: options.baseBranch,
      ...(options.branch ? { branch: options.branch } : {}),
    },
    logger,
  })

  return {
    failure,
    action: 'agent-fix',
    fixed: result.stopReason === 'completed',
    report: report(failure, result.output || 'The repair run ended without a conclusion.'),
  }
}

/** Render a failure and its outcome as a comment body. */
function report(failure: ClassifiedFailure, conclusion: string): string {
  let body = `## 🩺 CI failure analysis\n\n**Diagnosis:** ${describeFailure(failure)}\n\n${conclusion}\n`

  if (failure.evidence.length > 0) {
    body += `\n<details><summary>Relevant log lines</summary>\n\n\`\`\`\n${
      failure.evidence.slice(0, 20).join('\n')
    }\n\`\`\`\n\n</details>\n`
  }

  return body
}
