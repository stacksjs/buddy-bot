import type { Logger } from '../utils/logger'
import type { ParsedCommand } from './parser'
import { getDefaultLogger } from '../utils/logger'
import { isReadOnlyCommand } from './parser'

/** Who triggered a command and what they may do. */
export interface CommandActor {
  login: string
  /** Whether the actor has write access to the repository */
  canWrite: boolean
  /** Whether the actor is a bot, including this one */
  isBot: boolean
}

/** Everything a handler needs to act. */
export interface CommandContext {
  command: ParsedCommand
  actor: CommandActor
  /** Issue or pull request the comment is on */
  number: number
  /** Whether the comment is on a pull request rather than an issue */
  isPullRequest: boolean
  /** Comment that carried the command, for reactions */
  commentId?: number
  logger: Logger
}

/** What a handler produced. */
export interface CommandOutcome {
  /** Whether the command ran */
  handled: boolean
  /** Message to post back, when there is one */
  reply?: string
  /** Why the command was refused, for logging */
  refusal?: string
}

/** A command implementation. */
export type CommandHandler = (context: CommandContext) => Promise<CommandOutcome>

/** Text for `@buddy-bot help`. */
export const HELP_TEXT = `**Buddy Bot commands**

| Command | What it does |
|---|---|
| \`@buddy-bot review\` | Review new changes since the last review |
| \`@buddy-bot full-review\` | Review the whole diff again, ignoring previous findings |
| \`@buddy-bot summary\` | Post a fresh summary without inline findings |
| \`@buddy-bot resolve\` | Resolve the review threads this bot opened |
| \`@buddy-bot pause\` / \`resume\` | Stop or restart reviewing this pull request |
| \`@buddy-bot rebase\` | Rebase a dependency update pull request |
| \`@buddy-bot merge\` | Re-check auto-merge conditions now |
| \`@buddy-bot fix-ci\` | Diagnose and try to fix failing checks |
| \`@buddy-bot plan\` | Produce an implementation plan for an issue |
| \`@buddy-bot remember <text>\` | Record a durable note for future runs |
| \`@buddy-bot help\` | Show this table |

Anything else after the mention is treated as a question.`

/**
 * Decide whether a command may run, without running it.
 *
 * Separated from execution so the permission rule is testable on its own and
 * cannot be bypassed by a handler that forgets to check.
 *
 * @param context - Command, actor and target
 * @returns `null` when allowed, or the refusal reason
 */
export function checkPermission(context: CommandContext): string | null {
  if (context.actor.isBot)
    return 'comment was written by a bot'

  if (isReadOnlyCommand(context.command.name))
    return null

  if (!context.actor.canWrite) {
    // Public repositories accept comments from anyone, so a mutating command
    // from someone without write access is refused rather than attempted.
    return `@${context.actor.login} does not have write access`
  }

  return null
}

/**
 * Route a command to its handler.
 *
 * @param context - Command, actor and target
 * @param handlers - Handlers by canonical command name
 * @returns The outcome, including a refusal when permission was denied
 * @example
 * ```ts
 * const outcome = await dispatchCommand(context, { review: runReview })
 * ```
 */
export async function dispatchCommand(
  context: CommandContext,
  handlers: Record<string, CommandHandler>,
): Promise<CommandOutcome> {
  const logger = context.logger ?? getDefaultLogger()

  const refusal = checkPermission(context)
  if (refusal) {
    logger.info(`🚫 Ignoring \`${context.command.name}\`: ${refusal}`)
    return { handled: false, refusal }
  }

  if (context.command.name === 'help')
    return { handled: true, reply: HELP_TEXT }

  const handler = handlers[context.command.name]
  if (!handler) {
    return {
      handled: false,
      refusal: `no handler for ${context.command.name}`,
      reply: `I don't know how to \`${context.command.name}\` yet. Try \`@buddy-bot help\`.`,
    }
  }

  logger.info(`🤖 Running \`${context.command.name}\` for @${context.actor.login}`)
  return await handler(context)
}
