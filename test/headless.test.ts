import type { AiClient, AiCompletionRequest, AiResponse } from '../src/ai/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diagnose, renderDoctorReport } from '../src/doctor'
import { formatGithubOutput, publishOutput, runHeadless, validateAgainstSchema } from '../src/headless/run'
import { Logger } from '../src/utils/logger'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'buddy-headless-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A client that returns each scripted answer in turn. */
function scriptedClient(answers: unknown[]): AiClient & { requests: AiCompletionRequest[] } {
  const requests: AiCompletionRequest[] = []
  let index = 0

  return {
    provider: 'anthropic',
    model: 'test',
    tokensUsed: 0,
    requests,
    async complete(request): Promise<AiResponse> {
      requests.push(request)
      const answer = answers[Math.min(index++, answers.length - 1)]
      const text = typeof answer === 'string' ? answer : JSON.stringify(answer)

      return {
        text,
        toolCalls: [],
        json: typeof answer === 'string' ? undefined : answer,
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'test',
      }
    },
  }
}

const OBJECT_SCHEMA = {
  type: 'object',
  properties: { markdown: { type: 'string' } },
  required: ['markdown'],
}

describe('schema validation', () => {
  it('success case - a conforming value has no violations', () => {
    expect(validateAgainstSchema({ markdown: 'x' }, OBJECT_SCHEMA)).toEqual([])
  })

  it('failure case - reports a missing required property by name', () => {
    const violations = validateAgainstSchema({}, OBJECT_SCHEMA)

    expect(violations).toHaveLength(1)
    expect(violations[0]).toEqual({ path: 'markdown', message: 'is required but missing' })
  })

  it('failure case - reports a wrong type at its path', () => {
    const violations = validateAgainstSchema({ markdown: 42 }, OBJECT_SCHEMA)

    expect(violations[0].path).toBe('markdown')
    expect(violations[0].message).toContain('expected string')
  })

  it('failure case - a wrong root type does not cascade', () => {
    // Reporting every missing property of a value that is not an object at all
    // is noise about a single mistake.
    expect(validateAgainstSchema('a string', OBJECT_SCHEMA)).toHaveLength(1)
  })

  it('success case - an integer satisfies number, but not the reverse', () => {
    expect(validateAgainstSchema(3, { type: 'number' })).toEqual([])
    expect(validateAgainstSchema(3, { type: 'integer' })).toEqual([])
    expect(validateAgainstSchema(3.5, { type: 'integer' })).toHaveLength(1)
  })

  it('success case - validates array items', () => {
    const schema = { type: 'array', items: { type: 'string' } }

    expect(validateAgainstSchema(['a', 'b'], schema)).toEqual([])
    expect(validateAgainstSchema(['a', 2], schema)[0].path).toBe('[1]')
  })

  it('success case - enforces enums', () => {
    expect(validateAgainstSchema('c', { enum: ['a', 'b'] })).toHaveLength(1)
    expect(validateAgainstSchema('a', { enum: ['a', 'b'] })).toEqual([])
  })

  it('success case - validates nested objects at their full path', () => {
    const schema = {
      type: 'object',
      properties: { outer: { type: 'object', properties: { inner: { type: 'string' } } } },
    }

    expect(validateAgainstSchema({ outer: { inner: 1 } }, schema)[0].path).toBe('outer.inner')
  })

  it('edge case - null is its own type, not an object', () => {
    expect(validateAgainstSchema(null, { type: 'object' })[0].message).toContain('got null')
  })
})

describe('headless runs', () => {
  it('success case - returns raw text when no schema is given', async () => {
    const outcome = await runHeadless({
      prompt: 'summarize',
      ai: scriptedClient(['some prose']),
      logger: Logger.silent(),
    })

    expect(outcome).toEqual({ result: 'some prose', valid: true, attempts: 1 })
  })

  it('success case - returns the parsed object when it conforms', async () => {
    const outcome = await runHeadless({
      prompt: 'summarize',
      ai: scriptedClient([{ markdown: '# notes' }]),
      schema: OBJECT_SCHEMA,
      logger: Logger.silent(),
    })

    expect(outcome.result).toEqual({ markdown: '# notes' })
    expect(outcome.attempts).toBe(1)
  })

  it('success case - retries with the violations quoted back', async () => {
    // Burning a pipeline step on a formatting slip would be needless when a
    // re-ask usually succeeds.
    const ai = scriptedClient([{ wrong: true }, { markdown: 'fixed' }])

    const outcome = await runHeadless({
      prompt: 'summarize',
      ai,
      schema: OBJECT_SCHEMA,
      logger: Logger.silent(),
    })

    expect(outcome.valid).toBe(true)
    expect(outcome.attempts).toBe(2)
    expect(ai.requests[1].messages[0].content).toContain('markdown: is required but missing')
  })

  it('failure case - persistent nonconformance fails rather than emitting', async () => {
    // The contract a pipeline depends on: a later fromJSON() needs the step to
    // have failed, not to have emitted a different shape.
    const outcome = await runHeadless({
      prompt: 'summarize',
      ai: scriptedClient([{ wrong: true }]),
      schema: OBJECT_SCHEMA,
      maxRetries: 1,
      logger: Logger.silent(),
    })

    expect(outcome.valid).toBe(false)
    expect(outcome.result).toBeNull()
    expect(outcome.attempts).toBe(2)
    expect(outcome.error).toContain('markdown')
  })

  it('failure case - output that is not JSON at all fails', async () => {
    const outcome = await runHeadless({
      prompt: 'summarize',
      ai: scriptedClient(['I cannot do that']),
      schema: OBJECT_SCHEMA,
      maxRetries: 0,
      logger: Logger.silent(),
    })

    expect(outcome.valid).toBe(false)
    expect(outcome.error).toContain('not valid JSON')
  })

  it('success case - tells the model there is nobody to ask', async () => {
    const ai = scriptedClient(['x'])

    await runHeadless({ prompt: 'do it', ai, logger: Logger.silent() })

    expect(ai.requests[0].system).toContain('no interactive user')
  })
})

describe('github output formatting', () => {
  it('success case - a single-line value is a plain assignment', () => {
    expect(formatGithubOutput('result', 'hello')).toBe('result=hello\n')
  })

  it('success case - a multi-line value uses heredoc syntax', () => {
    expect(formatGithubOutput('result', 'a\nb')).toBe('result<<BUDDY_EOF\na\nb\nBUDDY_EOF\n')
  })

  it('failure case - a value containing the delimiter gets a fresh one', () => {
    // Otherwise crafted output could close the block early and inject further
    // outputs into the workflow — a real escalation when a later step
    // interpolates them.
    const formatted = formatGithubOutput('result', 'a\nBUDDY_EOF\nb')

    expect(formatted).toContain('BUDDY_EOF_1')
    expect(formatted.startsWith('result<<BUDDY_EOF_1\n')).toBe(true)
  })

  it('edge case - escalates again if the fresh delimiter also appears', () => {
    const formatted = formatGithubOutput('result', 'BUDDY_EOF\nBUDDY_EOF_1\nx')

    expect(formatted.startsWith('result<<BUDDY_EOF_2\n')).toBe(true)
  })

  it('success case - appends to an existing output file', async () => {
    const path = join(dir, 'output')
    await Bun.write(path, 'earlier=1\n')

    expect(await publishOutput({ markdown: 'x' }, path)).toBe(true)
    expect(await readFile(path, 'utf-8')).toBe('earlier=1\nresult={"markdown":"x"}\n')
  })

  it('failure case - outside Actions nothing is written', async () => {
    expect(await publishOutput('x', undefined)).toBe(false)
  })
})

describe('doctor', () => {
  const noTools = { hasCommand: async () => false }

  it('success case - reports a healthy environment', async () => {
    const report = await diagnose(
      { repository: { provider: 'github', owner: 'o', name: 'r' } },
      { ...noTools, env: { GITHUB_TOKEN: 't', ANTHROPIC_API_KEY: 'k' }, cwd: process.cwd() },
    )

    expect(report.healthy).toBe(true)
    expect(report.checks.find(check => check.name === 'git token')?.status).toBe('ok')
    expect(report.checks.find(check => check.name === 'ai provider')?.status).toBe('ok')
  })

  it('success case - missing credentials are warnings, not failures', async () => {
    // They are absent optional capabilities: dependency updates and static
    // analysis both work without them.
    const report = await diagnose(
      { repository: { provider: 'github', owner: 'o', name: 'r' } },
      { ...noTools, env: {}, cwd: process.cwd() },
    )

    expect(report.healthy).toBe(true)
    expect(report.checks.find(check => check.name === 'git token')?.status).toBe('warn')
  })

  it('failure case - a broken config is a failure', async () => {
    const report = await diagnose(
      { repository: { provider: 'gitlab' as never, owner: 'o', name: 'r' } },
      { ...noTools, env: {}, cwd: process.cwd() },
    )

    expect(report.healthy).toBe(false)
    expect(report.checks.find(check => check.name === 'configuration')?.status).toBe('fail')
  })

  it('failure case - a non-repository is a failure with a fix', async () => {
    const report = await diagnose({}, { ...noTools, env: {}, cwd: dir })

    expect(report.healthy).toBe(false)
    expect(report.checks.find(check => check.name === 'git repository')?.remediation).toContain('git init')
  })

  it('success case - every problem carries a remediation', async () => {
    // A check that reports a problem without saying what to do about it has
    // moved the question rather than answered it.
    const report = await diagnose({}, { ...noTools, env: {}, cwd: dir })

    for (const check of report.checks) {
      if (check.status !== 'ok')
        expect(check.remediation).toBeTruthy()
    }
  })

  it('success case - names installed analyzer tools', async () => {
    const report = await diagnose({}, {
      env: {},
      cwd: process.cwd(),
      hasCommand: async command => command === 'shellcheck',
    })

    expect(report.checks.find(check => check.name === 'analyzer: shellcheck')?.status).toBe('ok')
    expect(report.checks.find(check => check.name === 'analyzer: hadolint')?.status).toBe('warn')
  })

  it('success case - renders a readable report', async () => {
    const report = await diagnose({}, { ...noTools, env: {}, cwd: process.cwd() })
    const rendered = renderDoctorReport(report)

    expect(rendered).toContain('Buddy Bot environment')
    expect(rendered).toContain('→')
  })
})
