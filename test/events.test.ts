import type { EventSink } from '../src/events/bus'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import process from 'node:process'
import { describeEvent, EventBus } from '../src/events/bus'
import { createSinks, createWebhookSink, sign, WEBHOOK_PAYLOAD_VERSION } from '../src/events/sinks'
import { Logger } from '../src/utils/logger'

const ENV_VARS = ['SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL', 'TEST_WEBHOOK_SECRET']
let saved: Record<string, string | undefined> = {}
const realFetch = globalThis.fetch

beforeEach(() => {
  saved = Object.fromEntries(ENV_VARS.map(name => [name, process.env[name]]))
  for (const name of ENV_VARS)
    delete process.env[name]
})

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined)
      delete process.env[name]
    else
      process.env[name] = value
  }
  globalThis.fetch = realFetch
})

/** A sink that records what it received. */
function recordingSink(name: string, events?: Parameters<EventBus['emit']>[0][]): EventSink & { received: string[] } {
  const received: string[] = []
  return {
    name,
    received,
    ...(events ? { events } : {}),
    async deliver(event) {
      received.push(event)
    },
  }
}

describe('event bus', () => {
  it('success case - delivers to every interested sink', async () => {
    const bus = new EventBus(Logger.quiet())
    const a = recordingSink('a')
    const b = recordingSink('b')
    bus.register(a)
    bus.register(b)

    await bus.emit('pr.created', { number: 1, title: 't', url: 'u', packages: [] })

    expect(a.received).toEqual(['pr.created'])
    expect(b.received).toEqual(['pr.created'])
  })

  it('success case - a sink receives only the events it subscribed to', async () => {
    const bus = new EventBus(Logger.quiet())
    const sink = recordingSink('selective', ['security.advisories'])
    bus.register(sink)

    await bus.emit('pr.created', { number: 1, title: 't', url: 'u', packages: [] })
    await bus.emit('security.advisories', { packages: [{ name: 'x', severity: 'high' }] })

    expect(sink.received).toEqual(['security.advisories'])
  })

  it('failure case - one failing sink does not stop the others', async () => {
    // Notification is a side effect of the work, never a precondition for it.
    const bus = new EventBus(Logger.quiet())
    const working = recordingSink('working')

    bus.register({
      name: 'broken',
      async deliver() {
        throw new Error('outage')
      },
    })
    bus.register(working)

    await expect(bus.emit('pr.created', { number: 1, title: 't', url: 'u', packages: [] })).resolves.toBeUndefined()
    expect(working.received).toEqual(['pr.created'])
  })

  it('edge case - emitting with no sinks is a no-op', async () => {
    const bus = new EventBus(Logger.quiet())

    await expect(bus.emit('scan.completed', { total: 0, major: 0, minor: 0, patch: 0 })).resolves.toBeUndefined()
    expect(bus.size).toBe(0)
  })
})

describe('event descriptions', () => {
  it('success case - describes each event in plain language', () => {
    expect(describeEvent('scan.completed', { total: 5, major: 1, minor: 2, patch: 2 })).toContain('5 update(s)')
    expect(describeEvent('pr.created', { number: 7, title: 'bump react', url: '', packages: [] })).toContain('#7')
    expect(describeEvent('pr.merged', { number: 7, title: 'bump react', strategy: 'squash' })).toContain('Merged #7')
    expect(describeEvent('run.failed', { command: 'scan', error: 'boom' })).toContain('boom')
  })
})

describe('sink construction', () => {
  it('failure case - builds no sinks without credentials', () => {
    expect(createSinks({ slack: {}, discord: {} })).toEqual([])
  })

  it('success case - builds a sink when its credential is present', () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'

    expect(createSinks({ slack: {} }).map(sink => sink.name)).toEqual(['slack'])
  })

  it('success case - honours a custom environment variable name', () => {
    process.env.TEST_WEBHOOK_SECRET = 'https://hooks.slack.test/x'

    expect(createSinks({ slack: { webhookEnv: 'TEST_WEBHOOK_SECRET' } })).toHaveLength(1)
  })

  it('success case - always builds configured webhook sinks', () => {
    const sinks = createSinks({ webhooks: [{ url: 'https://example.test/hook' }] })

    expect(sinks.map(sink => sink.name)).toEqual(['webhook[0]'])
  })

  it('edge case - no configuration yields no sinks', () => {
    expect(createSinks(undefined)).toEqual([])
  })
})

describe('webhook delivery', () => {
  it('success case - posts a versioned payload', async () => {
    let body = ''
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = String(init.body)
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    await createWebhookSink({ url: 'https://example.test/hook' })
      .deliver('pr.created', { number: 3, title: 't', url: 'u', packages: ['react'] })

    const parsed = JSON.parse(body)
    expect(parsed.version).toBe(WEBHOOK_PAYLOAD_VERSION)
    expect(parsed.event).toBe('pr.created')
    expect(parsed.payload.number).toBe(3)
  })

  it('success case - signs the payload so a receiver can verify it', async () => {
    // Without a signature this is an unauthenticated POST anyone could forge.
    process.env.TEST_WEBHOOK_SECRET = 'shared-secret'
    let headers: Record<string, string> = {}
    let body = ''

    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>
      body = String(init.body)
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    await createWebhookSink({ url: 'https://example.test/hook', secretEnv: 'TEST_WEBHOOK_SECRET' })
      .deliver('pr.created', { number: 3, title: 't', url: 'u', packages: [] })

    expect(headers['x-buddy-bot-signature']).toBe(`sha256=${sign(body, 'shared-secret')}`)
  })

  it('failure case - an unsigned sink sends no signature header', async () => {
    let headers: Record<string, string> = {}
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    await createWebhookSink({ url: 'https://example.test/hook' })
      .deliver('pr.created', { number: 1, title: 't', url: 'u', packages: [] })

    expect(headers['x-buddy-bot-signature']).toBeUndefined()
  })

  it('failure case - a non-2xx response throws for the bus to contain', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500, statusText: 'Server Error' })) as unknown as typeof fetch

    const sink = createWebhookSink({ url: 'https://example.test/hook' })

    await expect(sink.deliver('pr.created', { number: 1, title: 't', url: 'u', packages: [] })).rejects.toThrow()
  })

  it('success case - the signature changes with the payload', () => {
    expect(sign('a', 'secret')).not.toBe(sign('b', 'secret'))
    expect(sign('a', 'secret1')).not.toBe(sign('a', 'secret2'))
  })
})
