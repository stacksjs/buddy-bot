import type { BuddyBotConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import process from 'node:process'
import { resolveModelAlias } from '../src/ai/aliases'
import { createAiClient, resolveAiProvider } from '../src/ai/client'
import { createGoogleProvider } from '../src/ai/providers/google'
import { createOpenAiProvider } from '../src/ai/providers/openai'
import { redact, redactDeep, redactError } from '../src/ai/redact'
import { AiBudgetExceededError, AiProviderError } from '../src/ai/types'

/** Env vars the resolver reads, cleared between tests so runs are isolated. */
const KEY_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY',
  'BUDDY_BOT_MODEL',
  'CUSTOM_KEY_VAR',
]

let savedEnv: Record<string, string | undefined> = {}
const realFetch = globalThis.fetch

function stubFetch(payload: unknown, init: { status?: number } = {}): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch
}

beforeEach(() => {
  savedEnv = Object.fromEntries(KEY_VARS.map(name => [name, process.env[name]]))
  for (const name of KEY_VARS)
    delete process.env[name]
})

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined)
      delete process.env[name]
    else
      process.env[name] = value
  }
  globalThis.fetch = realFetch
})

describe('model aliases', () => {
  it('success case - resolves short aliases to concrete models', () => {
    expect(resolveModelAlias('opus')).toBe('claude-opus-5')
    expect(resolveModelAlias('sonnet')).toBe('claude-sonnet-5')
    expect(resolveModelAlias('haiku')).toBe('claude-haiku-4-5')
  })

  it('edge case - is case and whitespace insensitive', () => {
    expect(resolveModelAlias('  Opus ')).toBe('claude-opus-5')
  })

  it('edge case - passes unknown models through unchanged', () => {
    // A model released after this table was written must still be usable.
    expect(resolveModelAlias('some-future-model-9')).toBe('some-future-model-9')
  })
})

describe('provider resolution', () => {
  it('failure case - returns null when no key is present', () => {
    expect(resolveAiProvider({})).toBeNull()
  })

  it('failure case - returns null when explicitly disabled', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    expect(resolveAiProvider({ ai: { enabled: false } })).toBeNull()
  })

  it('success case - auto-selects the first provider with a key', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'

    const resolution = resolveAiProvider({ ai: { model: 'gpt-test' } })

    expect(resolution?.provider).toBe('openai')
    expect(resolution?.model).toBe('gpt-test')
  })

  it('success case - prefers anthropic when several keys are present', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    expect(resolveAiProvider({})?.provider).toBe('anthropic')
  })

  it('success case - honours an explicit provider', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    const resolution = resolveAiProvider({ ai: { provider: 'openai', model: 'gpt-test' } })

    expect(resolution?.provider).toBe('openai')
  })

  it('success case - defaults anthropic to a concrete model', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    expect(resolveAiProvider({})?.model).toBe('claude-opus-5')
  })

  it('failure case - skips a provider with a key but no resolvable model', () => {
    // Only Anthropic ships a default model; inventing one for another vendor
    // would route requests to a model the user never chose.
    process.env.OPENAI_API_KEY = 'sk-openai-test'

    expect(resolveAiProvider({ ai: { provider: 'openai' } })).toBeNull()
  })

  it('success case - reads a custom key environment variable', () => {
    process.env.CUSTOM_KEY_VAR = 'sk-custom-test'

    const resolution = resolveAiProvider({ ai: { provider: 'anthropic', apiKeyEnv: 'CUSTOM_KEY_VAR' } })

    expect(resolution?.apiKey).toBe('sk-custom-test')
  })

  it('success case - BUDDY_BOT_MODEL overrides the configured model', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    process.env.BUDDY_BOT_MODEL = 'haiku'

    expect(resolveAiProvider({ ai: { model: 'opus' } })?.model).toBe('claude-haiku-4-5')
  })

  it('edge case - treats a blank key as absent', () => {
    process.env.ANTHROPIC_API_KEY = '   '

    expect(resolveAiProvider({})).toBeNull()
  })
})

describe('createAiClient', () => {
  it('failure case - returns null rather than throwing with no key', () => {
    // Graceful absence: the dependency bot must work with no AI configured.
    expect(createAiClient({})).toBeNull()
  })

  it('success case - reports the resolved provider and model', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    const client = createAiClient({})

    expect(client?.provider).toBe('anthropic')
    expect(client?.model).toBe('claude-opus-5')
  })
})

describe('openAI-compatible provider', () => {
  const config: BuddyBotConfig = { ai: { provider: 'openai', model: 'test-model' } }

  it('success case - maps a chat completion onto the normalized shape', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    stubFetch({
      model: 'test-model',
      choices: [{ finish_reason: 'stop', message: { content: 'hello there' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    })

    const response = await createAiClient(config)!.complete({
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.text).toBe('hello there')
    expect(response.stopReason).toBe('end')
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 4 })
    expect(response.model).toBe('test-model')
  })

  it('success case - normalizes tool calls', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    stubFetch({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'get_diff', arguments: '{"pr":42}' } }],
        },
      }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })

    const response = await createAiClient(config)!.complete({
      messages: [{ role: 'user', content: 'review' }],
      tools: [{ name: 'get_diff', description: 'Fetch a diff', parameters: { type: 'object' } }],
    })

    expect(response.stopReason).toBe('tool_use')
    expect(response.toolCalls).toEqual([{ id: 'call_1', name: 'get_diff', input: { pr: 42 } }])
  })

  it('success case - parses structured output', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    stubFetch({
      choices: [{ finish_reason: 'stop', message: { content: '{"severity":"major"}' } }],
      usage: {},
    })

    const response = await createAiClient(config)!.complete({
      messages: [{ role: 'user', content: 'classify' }],
      jsonSchema: { type: 'object', properties: { severity: { type: 'string' } } },
    })

    expect(response.json).toEqual({ severity: 'major' })
  })

  it('failure case - reports malformed structured output', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    stubFetch({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }], usage: {} })

    const promise = createAiClient(config)!.complete({
      messages: [{ role: 'user', content: 'classify' }],
      jsonSchema: { type: 'object' },
    })

    await expect(promise).rejects.toThrow(AiProviderError)
  })

  it('failure case - surfaces an HTTP error without leaking the key', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-supersecretvalue12345'
    globalThis.fetch = (async () => new Response(
      'invalid api key sk-openai-supersecretvalue12345',
      { status: 401, statusText: 'Unauthorized' },
    )) as unknown as typeof fetch

    const promise = createAiClient(config)!.complete({ messages: [{ role: 'user', content: 'hi' }] })

    await expect(promise).rejects.toThrow(AiProviderError)
    await promise.catch((error: AiProviderError) => {
      expect(error.status).toBe(401)
      expect(error.message).not.toContain('supersecretvalue')
    })
  })

  it('edge case - maps a length stop to max_tokens', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    stubFetch({ choices: [{ finish_reason: 'length', message: { content: 'trunc' } }], usage: {} })

    const response = await createAiClient(config)!.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(response.stopReason).toBe('max_tokens')
  })
})

describe('google provider', () => {
  it('success case - maps a Gemini response onto the normalized shape', async () => {
    stubFetch({
      modelVersion: 'gemini-test',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hello' }] } }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
    })

    const response = await createGoogleProvider({ apiKey: 'AIzaTestKeyValue00000' })
      .complete({ messages: [{ role: 'user', content: 'hi' }] }, 'gemini-test')

    expect(response.text).toBe('hello')
    expect(response.stopReason).toBe('end')
    expect(response.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })

  it('success case - normalizes function calls and synthesizes IDs', async () => {
    // Gemini assigns no call IDs, so the layer supplies stable ones.
    stubFetch({
      candidates: [{
        content: { parts: [{ functionCall: { name: 'lookup', args: { pkg: 'react' } } }] },
      }],
    })

    const response = await createGoogleProvider({ apiKey: 'AIzaTestKeyValue00000' })
      .complete({ messages: [{ role: 'user', content: 'hi' }] }, 'gemini-test')

    expect(response.stopReason).toBe('tool_use')
    expect(response.toolCalls[0]).toMatchObject({ name: 'lookup', input: { pkg: 'react' } })
    expect(response.toolCalls[0].id).toBeTruthy()
  })

  it('edge case - maps a safety stop to refusal', async () => {
    stubFetch({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })

    const response = await createGoogleProvider({ apiKey: 'AIzaTestKeyValue00000' })
      .complete({ messages: [{ role: 'user', content: 'hi' }] }, 'gemini-test')

    expect(response.stopReason).toBe('refusal')
  })
})

describe('anthropic provider', () => {
  it('success case - maps a message onto the normalized shape', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    stubFetch({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'looks good' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 20, output_tokens: 5 },
    })

    const response = await createAiClient({})!.complete({
      messages: [{ role: 'user', content: 'review this' }],
    })

    expect(response.text).toBe('looks good')
    expect(response.stopReason).toBe('end')
    expect(response.usage).toEqual({ inputTokens: 20, outputTokens: 5 })
  })

  it('success case - normalizes tool_use blocks', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    stubFetch({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.ts' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 8 },
    })

    const response = await createAiClient({})!.complete({
      messages: [{ role: 'user', content: 'read it' }],
      tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }],
    })

    expect(response.stopReason).toBe('tool_use')
    expect(response.toolCalls).toEqual([{ id: 'toolu_1', name: 'read_file', input: { path: 'a.ts' } }])
    expect(response.text).toBe('checking')
  })

  it('edge case - preserves a refusal rather than reading it as an answer', async () => {
    // A refusal returns HTTP 200 with empty content; folding it into `end`
    // would make an empty answer look like a valid one.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    stubFetch({
      id: 'msg_3',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 4, output_tokens: 0 },
    })

    const response = await createAiClient({})!.complete({
      messages: [{ role: 'user', content: 'something declined' }],
    })

    expect(response.stopReason).toBe('refusal')
    expect(response.text).toBe('')
  })

  it('success case - reports cached input tokens when present', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    stubFetch({
      id: 'msg_4',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 900 },
    })

    const response = await createAiClient({})!.complete({
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.usage.cachedInputTokens).toBe(900)
  })
})

describe('token budget', () => {
  it('failure case - refuses further requests once the budget is spent', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    stubFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 100 },
    })

    const client = createAiClient({
      ai: { provider: 'openai', model: 'test-model', maxTokensPerRun: 50 },
    })!

    await client.complete({ messages: [{ role: 'user', content: 'first' }] })
    expect(client.tokensUsed).toBe(100)

    // Checked before the call, so an exhausted budget cannot overspend again.
    await expect(client.complete({ messages: [{ role: 'user', content: 'second' }] }))
      .rejects.toThrow(AiBudgetExceededError)
  })

  it('success case - accumulates output tokens across requests', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    stubFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 10 },
    })

    const client = createAiClient({ ai: { provider: 'openai', model: 'test-model' } })!
    await client.complete({ messages: [{ role: 'user', content: 'a' }] })
    await client.complete({ messages: [{ role: 'user', content: 'b' }] })

    expect(client.tokensUsed).toBe(20)
  })
})

describe('secret redaction', () => {
  it('success case - masks provider API keys', () => {
    expect(redact('failed with sk-ant-api03-abcdefghijklmnopqrstuv')).toBe('failed with [redacted]')
    expect(redact('key AIzaSyABCDEFGHIJKLMNOPQRSTUVWX')).toBe('key [redacted]')
  })

  it('success case - masks bearer headers and github tokens', () => {
    expect(redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toContain('[redacted]')
    expect(redact('token ghp_abcdefghijklmnopqrstuvwxyz1234')).toBe('token [redacted]')
  })

  it('success case - keeps the key name in assignment-shaped matches', () => {
    // The log should still say which credential was involved.
    const masked = redact('GITHUB_TOKEN=abcdefghijklmnop')

    expect(masked).toContain('GITHUB_TOKEN')
    expect(masked).not.toContain('abcdefghijklmnop')
  })

  it('edge case - leaves ordinary text alone', () => {
    expect(redact('updated typescript from 5.8.2 to 5.8.3')).toBe('updated typescript from 5.8.2 to 5.8.3')
  })

  it('success case - walks nested structures', () => {
    const masked = redactDeep({ nested: ['sk-ant-api03-abcdefghijklmnopqrstuv'], count: 2 }) as any

    expect(masked.nested[0]).toBe('[redacted]')
    expect(masked.count).toBe(2)
  })

  it('success case - redacts thrown errors', () => {
    expect(redactError(new Error('bad key sk-ant-api03-abcdefghijklmnopqrstuv'))).toBe('bad key [redacted]')
    expect(redactError('plain failure')).toBe('plain failure')
  })
})
