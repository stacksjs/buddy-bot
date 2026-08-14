/** A command a maintainer addressed to the bot. */
export interface ParsedCommand {
  /** Canonical command name, or `chat` for free-form text */
  name: string
  /** Everything after the command word */
  args: string
  /** The raw mention line, for logging */
  raw: string
}

/** Commands the dispatcher understands, with their aliases. */
export const COMMAND_ALIASES: Record<string, string> = {
  'review': 'review',
  'full-review': 'full-review',
  'full': 'full-review',
  'summary': 'summary',
  'resolve': 'resolve',
  'pause': 'pause',
  'resume': 'resume',
  'ignore': 'ignore',
  'rebase': 'rebase',
  'retry': 'rebase',
  'merge': 'merge',
  'plan': 'plan',
  'fix-ci': 'fix-ci',
  'fix': 'fix-ci',
  'remember': 'remember',
  'help': 'help',
}

/** Commands anyone may run; the rest require write access. */
export const READ_ONLY_COMMANDS: string[] = ['help', 'summary']

/**
 * Strip fenced blocks, inline code and blockquotes.
 *
 * A mention inside a code fence is almost always someone documenting the bot
 * rather than invoking it, and a mention inside a quote is someone replying to
 * a message that contained one. Acting on either turns a discussion about the
 * bot into a command from it.
 */
export function stripNonCommandContext(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('>'))
    .join('\n')
}

/**
 * Find a command addressed to the bot in a comment body.
 *
 * @param body - Comment body
 * @param mention - Mention that addresses the bot (default: `@buddy-bot`)
 * @returns The command, or `null` when the comment does not address the bot
 * @example
 * ```ts
 * parseCommand('@buddy-bot review please') // => { name: 'review', args: 'please' }
 * parseCommand('use `@buddy-bot review`')  // => null (documentation, not a command)
 * ```
 */
export function parseCommand(body: string | null | undefined, mention = '@buddy-bot'): ParsedCommand | null {
  if (!body)
    return null

  const cleaned = stripNonCommandContext(body)
  const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\s)${escaped}\\b[ \\t]*(.*)`, 'i')

  const match = cleaned.match(pattern)
  if (!match)
    return null

  const rest = (match[1] ?? '').trim()
  if (!rest)
    return { name: 'help', args: '', raw: match[0].trim() }

  const [first, ...remainder] = rest.split(/\s+/)
  const canonical = COMMAND_ALIASES[first.toLowerCase()]

  // Anything that is not a known command is a question for the bot, not a typo
  // to reject — refusing free-form text would make the mention useless for the
  // conversational half of the feature.
  if (!canonical)
    return { name: 'chat', args: rest, raw: match[0].trim() }

  return { name: canonical, args: remainder.join(' '), raw: match[0].trim() }
}

/**
 * Whether a command may be run by someone without write access.
 *
 * @param name - Canonical command name
 */
export function isReadOnlyCommand(name: string): boolean {
  return READ_ONLY_COMMANDS.includes(name)
}

/**
 * Whether a comment could possibly contain a command.
 *
 * Used as a cheap pre-filter before a workflow checks out the repository, so
 * ordinary conversation costs nothing.
 *
 * @param body - Comment body
 * @param mention - Mention that addresses the bot
 */
export function mentionsBot(body: string | null | undefined, mention = '@buddy-bot'): boolean {
  return Boolean(body?.toLowerCase().includes(mention.toLowerCase()))
}
