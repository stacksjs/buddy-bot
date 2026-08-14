import type { GitProvider } from '../git/provider'
import type { BuddyBotConfig } from '../types'
import type { CommandContext, CommandHandler, CommandOutcome } from './dispatcher'
import process from 'node:process'
import { createAiClient } from '../ai'
import { attemptFix } from '../ci/fix'
import { serializeReviewState } from '../review/marker'

/** Everything the built-in handlers need to act. */
export interface HandlerDeps {
  config: BuddyBotConfig
  provider: GitProvider
  /** Review a pull request and post the result */
  review: (prNumber: number, options: { full?: boolean, summaryOnly?: boolean }) => Promise<string>
  /** Rebase a dependency update pull request */
  rebase: (prNumber: number) => Promise<string>
  /** Re-evaluate auto-merge conditions now */
  merge: () => Promise<number[]>
  /** Record a durable note */
  remember: (text: string, context: CommandContext) => Promise<string>
}

/**
 * Build the built-in command handlers.
 *
 * Handlers are thin: each routes to machinery that already exists and is
 * tested on its own, so the command layer stays a dispatch concern rather than
 * a second implementation of every feature.
 *
 * @param deps - Configuration, provider and the operations to route to
 * @returns Handlers keyed by canonical command name
 */
export function createHandlers(deps: HandlerDeps): Record<string, CommandHandler> {
  return {
    async review(context): Promise<CommandOutcome> {
      if (!context.isPullRequest)
        return { handled: false, reply: 'There is nothing to review — this is an issue, not a pull request.' }

      const summary = await deps.review(context.number, {})
      return { handled: true, reply: summary }
    },

    async 'full-review'(context): Promise<CommandOutcome> {
      if (!context.isPullRequest)
        return { handled: false, reply: 'There is nothing to review — this is an issue, not a pull request.' }

      // A full review deliberately ignores previously-reported findings, which
      // is the only way to get a finding back after dismissing it.
      const summary = await deps.review(context.number, { full: true })
      return { handled: true, reply: summary }
    },

    async summary(context): Promise<CommandOutcome> {
      if (!context.isPullRequest)
        return { handled: false, reply: 'There is nothing to summarize — this is an issue, not a pull request.' }

      const summary = await deps.review(context.number, { summaryOnly: true })
      return { handled: true, reply: summary }
    },

    async pause(context): Promise<CommandOutcome> {
      await setPaused(deps, context.number, true)
      return { handled: true, reply: 'Paused. I will not review this pull request again until you say `@buddy-bot resume`.' }
    },

    async resume(context): Promise<CommandOutcome> {
      await setPaused(deps, context.number, false)
      return { handled: true, reply: 'Resumed. I will review the next push.' }
    },

    async ignore(context): Promise<CommandOutcome> {
      await setPaused(deps, context.number, true)
      return { handled: true, reply: 'Understood — I will leave this pull request alone.' }
    },

    async rebase(context): Promise<CommandOutcome> {
      const result = await deps.rebase(context.number)
      return { handled: true, reply: result }
    },

    async merge(context): Promise<CommandOutcome> {
      const merged = await deps.merge()

      return {
        handled: true,
        reply: merged.includes(context.number)
          ? 'Merged.'
          : 'This pull request does not currently qualify for auto-merge. '
            + 'Check the conditions in your config and whether its checks have passed.',
      }
    },

    async 'fix-ci'(context): Promise<CommandOutcome> {
      const ai = createAiClient(deps.config, context.logger)
      const outcome = await attemptFix({
        log: '',
        workspace: process.cwd(),
        baseBranch: deps.config.repository?.baseBranch ?? 'main',
        ai,
        logger: context.logger,
      })

      return { handled: true, reply: outcome.report }
    },

    async remember(context): Promise<CommandOutcome> {
      const text = context.command.args.trim()
      if (!text)
        return { handled: false, reply: 'Tell me what to remember, e.g. `@buddy-bot remember we pin react to 17`.' }

      const reply = await deps.remember(text, context)
      return { handled: true, reply }
    },

    async chat(context): Promise<CommandOutcome> {
      const ai = createAiClient(deps.config, context.logger)
      if (!ai) {
        return {
          handled: false,
          reply: 'I need an AI provider configured to answer questions. See https://buddy-bot.sh/ai/providers',
        }
      }

      const response = await ai.complete({
        system: 'You are Buddy Bot, answering a question in a pull request or issue thread. '
          + 'Be brief and concrete. If you do not know, say so rather than guessing.',
        messages: [{ role: 'user', content: context.command.args }],
      })

      return { handled: true, reply: response.text }
    },
  }
}

/**
 * Flip the paused flag in a pull request's review state.
 *
 * Pausing is stored in the same marker the review engine reads, so a paused
 * pull request is skipped by `needsReview` without any separate bookkeeping.
 */
async function setPaused(deps: HandlerDeps, prNumber: number, paused: boolean): Promise<void> {
  const prs = await deps.provider.getPullRequests('open')
  const pr = prs.find(candidate => candidate.number === prNumber)
  if (!pr)
    return

  const { parseReviewState } = await import('../review/marker')
  const state = parseReviewState(pr.body)

  const marker = serializeReviewState({
    reviewedSha: state?.reviewedSha ?? '',
    fingerprints: state?.fingerprints ?? [],
    reviewedAt: state?.reviewedAt ?? new Date().toISOString(),
    ...(paused ? { paused: true } : {}),
  })

  const body = pr.body.replace(/<!--\s*buddy-bot:review[\s\S]*?-->/, '').trimEnd()
  await deps.provider.updatePullRequest(prNumber, { body: `${body}\n\n${marker}` })
}
