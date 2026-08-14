import type { CommandContext } from '../src/commands/dispatcher'
import { describe, expect, it } from 'bun:test'
import { checkPermission, dispatchCommand, HELP_TEXT } from '../src/commands/dispatcher'
import { isReadOnlyCommand, mentionsBot, parseCommand, stripNonCommandContext } from '../src/commands/parser'
import { Logger } from '../src/utils/logger'

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    command: { name: 'review', args: '', raw: '@buddy-bot review' },
    actor: { login: 'maintainer', canWrite: true, isBot: false },
    number: 42,
    isPullRequest: true,
    logger: Logger.quiet(),
    ...overrides,
  }
}

describe('command parsing', () => {
  it('success case - parses a bare command', () => {
    expect(parseCommand('@buddy-bot review')).toMatchObject({ name: 'review', args: '' })
  })

  it('success case - parses a command with arguments', () => {
    expect(parseCommand('@buddy-bot remember we pin react to 17')).toMatchObject({
      name: 'remember',
      args: 'we pin react to 17',
    })
  })

  it('success case - resolves aliases', () => {
    expect(parseCommand('@buddy-bot retry')?.name).toBe('rebase')
    expect(parseCommand('@buddy-bot fix')?.name).toBe('fix-ci')
    expect(parseCommand('@buddy-bot full')?.name).toBe('full-review')
  })

  it('success case - is case insensitive', () => {
    expect(parseCommand('@Buddy-Bot REVIEW')?.name).toBe('review')
  })

  it('success case - finds a mention mid-sentence', () => {
    expect(parseCommand('thanks, @buddy-bot review this when you can')?.name).toBe('review')
  })

  it('success case - treats unknown text as a question', () => {
    // Refusing free-form text would make the mention useless for chat.
    expect(parseCommand('@buddy-bot why did you pick this version?')).toMatchObject({
      name: 'chat',
      args: 'why did you pick this version?',
    })
  })

  it('success case - a bare mention asks for help', () => {
    expect(parseCommand('@buddy-bot')?.name).toBe('help')
  })

  it('failure case - ignores a mention inside a fenced code block', () => {
    // Documenting the bot is not invoking it.
    const body = 'Run this:\n\n```\n@buddy-bot review\n```\n'

    expect(parseCommand(body)).toBeNull()
  })

  it('failure case - ignores a mention in inline code', () => {
    expect(parseCommand('use `@buddy-bot review` to trigger a review')).toBeNull()
  })

  it('failure case - ignores a mention inside a blockquote', () => {
    // Quoting someone else's command is not issuing one.
    expect(parseCommand('> @buddy-bot review\n\nI agree with this')).toBeNull()
  })

  it('failure case - returns null when the bot is not mentioned', () => {
    expect(parseCommand('looks good to me')).toBeNull()
    expect(parseCommand('')).toBeNull()
    expect(parseCommand(null)).toBeNull()
  })

  it('edge case - honours a custom mention name', () => {
    expect(parseCommand('@depbot review', '@depbot')?.name).toBe('review')
    expect(parseCommand('@buddy-bot review', '@depbot')).toBeNull()
  })

  it('edge case - strips fences without losing surrounding text', () => {
    const stripped = stripNonCommandContext('before\n```\ninside\n```\nafter')

    expect(stripped).toContain('before')
    expect(stripped).toContain('after')
    expect(stripped).not.toContain('inside')
  })
})

describe('mention pre-filter', () => {
  it('success case - detects a mention cheaply', () => {
    expect(mentionsBot('hey @buddy-bot')).toBe(true)
    expect(mentionsBot('nothing here')).toBe(false)
  })

  it('edge case - the pre-filter is deliberately looser than the parser', () => {
    // The workflow guard errs toward running; the parser makes the real call.
    expect(mentionsBot('`@buddy-bot review`')).toBe(true)
    expect(parseCommand('`@buddy-bot review`')).toBeNull()
  })
})

describe('permissions', () => {
  it('success case - a maintainer may run a mutating command', () => {
    expect(checkPermission(makeContext())).toBeNull()
  })

  it('failure case - a non-collaborator may not run a mutating command', () => {
    const context = makeContext({ actor: { login: 'drive-by', canWrite: false, isBot: false } })

    expect(checkPermission(context)).toContain('does not have write access')
  })

  it('success case - anyone may run a read-only command', () => {
    const context = makeContext({
      command: { name: 'help', args: '', raw: '' },
      actor: { login: 'drive-by', canWrite: false, isBot: false },
    })

    expect(checkPermission(context)).toBeNull()
  })

  it('failure case - a bot comment never triggers a command', () => {
    // Otherwise the bot's own replies would re-trigger it.
    const context = makeContext({ actor: { login: 'github-actions[bot]', canWrite: true, isBot: true } })

    expect(checkPermission(context)).toContain('bot')
  })

  it('success case - classifies read-only commands', () => {
    expect(isReadOnlyCommand('help')).toBe(true)
    expect(isReadOnlyCommand('summary')).toBe(true)
    expect(isReadOnlyCommand('merge')).toBe(false)
  })
})

describe('dispatch', () => {
  it('success case - routes to the matching handler', async () => {
    let ran = false
    const outcome = await dispatchCommand(makeContext(), {
      review: async () => {
        ran = true
        return { handled: true, reply: 'reviewed' }
      },
    })

    expect(ran).toBe(true)
    expect(outcome).toMatchObject({ handled: true, reply: 'reviewed' })
  })

  it('success case - answers help without a handler', async () => {
    const outcome = await dispatchCommand(
      makeContext({ command: { name: 'help', args: '', raw: '' } }),
      {},
    )

    expect(outcome.reply).toBe(HELP_TEXT)
  })

  it('failure case - refuses before running when permission is denied', async () => {
    let ran = false
    const outcome = await dispatchCommand(
      makeContext({ actor: { login: 'drive-by', canWrite: false, isBot: false } }),
      {
        review: async () => {
          ran = true
          return { handled: true }
        },
      },
    )

    // The permission check must gate execution, not report after the fact.
    expect(ran).toBe(false)
    expect(outcome.handled).toBe(false)
  })

  it('failure case - reports an unimplemented command helpfully', async () => {
    const outcome = await dispatchCommand(
      makeContext({ command: { name: 'plan', args: '', raw: '' } }),
      {},
    )

    expect(outcome.handled).toBe(false)
    expect(outcome.reply).toContain('help')
  })
})
