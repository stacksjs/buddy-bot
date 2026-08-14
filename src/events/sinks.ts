import type { BuddyEvents, EventSink } from './bus'
import { createHmac } from 'node:crypto'
import process from 'node:process'
import { redact } from '../ai/redact'
import { fetchWithTimeout } from '../utils/http'
import { describeEvent } from './bus'

/** Payload schema version, so a webhook consumer can branch on shape changes. */
export const WEBHOOK_PAYLOAD_VERSION = 1

/** Notification destinations, as configured. */
export interface NotificationConfig {
  slack?: { webhookEnv?: string, events?: Array<keyof BuddyEvents> }
  discord?: { webhookEnv?: string, events?: Array<keyof BuddyEvents> }
  webhooks?: Array<{ url: string, secretEnv?: string, events?: Array<keyof BuddyEvents> }>
}

/**
 * Build sinks from configuration.
 *
 * Secrets are referenced by environment variable name rather than inlined, so
 * a notification target can be committed to the repository without committing
 * the credential that reaches it.
 *
 * @param config - Notification configuration
 * @returns Sinks for every destination whose credential is present
 */
export function createSinks(config: NotificationConfig | undefined): EventSink[] {
  if (!config)
    return []

  const sinks: EventSink[] = []

  const slackUrl = readEnv(config.slack?.webhookEnv ?? 'SLACK_WEBHOOK_URL')
  if (slackUrl)
    sinks.push(createSlackSink(slackUrl, config.slack?.events))

  const discordUrl = readEnv(config.discord?.webhookEnv ?? 'DISCORD_WEBHOOK_URL')
  if (discordUrl)
    sinks.push(createDiscordSink(discordUrl, config.discord?.events))

  for (const [index, webhook] of (config.webhooks ?? []).entries())
    sinks.push(createWebhookSink(webhook, index))

  return sinks
}

/** Slack sink, rendering events as block messages. */
export function createSlackSink(url: string, events?: Array<keyof BuddyEvents>): EventSink {
  return {
    name: 'slack',
    ...(events?.length ? { events } : {}),
    async deliver(event, payload) {
      await post(url, {
        text: `Buddy Bot: ${describeEvent(event, payload)}`,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Buddy Bot*\n${describeEvent(event, payload)}` },
        }],
      })
    },
  }
}

/** Discord sink, rendering events as embeds. */
export function createDiscordSink(url: string, events?: Array<keyof BuddyEvents>): EventSink {
  return {
    name: 'discord',
    ...(events?.length ? { events } : {}),
    async deliver(event, payload) {
      await post(url, {
        embeds: [{
          title: 'Buddy Bot',
          description: describeEvent(event, payload),
          color: event === 'security.advisories' || event === 'run.failed' ? 0xE0_1E_5A : 0x2E_B6_7D,
          timestamp: new Date().toISOString(),
        }],
      })
    },
  }
}

/**
 * Generic webhook sink, signed so a receiver can verify the sender.
 *
 * The signature is what makes this usable as an integration point rather than
 * an unauthenticated POST anyone could forge.
 */
export function createWebhookSink(
  webhook: { url: string, secretEnv?: string, events?: Array<keyof BuddyEvents> },
  index = 0,
): EventSink {
  const secret = webhook.secretEnv ? readEnv(webhook.secretEnv) : undefined

  return {
    name: `webhook[${index}]`,
    ...(webhook.events?.length ? { events: webhook.events } : {}),
    async deliver(event, payload) {
      const body = JSON.stringify({
        version: WEBHOOK_PAYLOAD_VERSION,
        event,
        payload,
        sentAt: new Date().toISOString(),
      })

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (secret)
        headers['x-buddy-bot-signature'] = `sha256=${sign(body, secret)}`

      await post(webhook.url, body, headers)
    },
  }
}

/** HMAC-SHA256 of a payload, as a receiver would recompute it. */
export function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    // The URL itself is a credential for Slack and Discord webhooks.
    throw new Error(`${response.status} ${response.statusText} ${redact(detail.slice(0, 200))}`.trim())
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value?.trim() ? value.trim() : undefined
}
