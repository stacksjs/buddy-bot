import type { Logger } from '../utils/logger'
import { getDefaultLogger } from '../utils/logger'

/** Events emitted from buddy-bot's real code paths. */
export interface BuddyEvents {
  'scan.completed': { total: number, major: number, minor: number, patch: number }
  'pr.created': { number: number, title: string, url: string, packages: string[] }
  'pr.updated': { number: number, title: string, url: string }
  'pr.closed': { number: number, title: string, reason: string }
  'pr.merged': { number: number, title: string, strategy: string }
  'security.advisories': { packages: Array<{ name: string, severity: string }> }
  'dashboard.updated': { number: number, url: string }
  'review.completed': { number: number, findings: number }
  'fixci.completed': { number?: number, action: string, fixed: boolean }
  'gate.failed': { number: number, checks: string[] }
  'run.failed': { command: string, error: string }
}

/** Every event name, for config validation and subscription lists. */
export const EVENT_NAMES: Array<keyof BuddyEvents> = [
  'scan.completed',
  'pr.created',
  'pr.updated',
  'pr.closed',
  'pr.merged',
  'security.advisories',
  'dashboard.updated',
  'review.completed',
  'fixci.completed',
  'gate.failed',
  'run.failed',
]

/** A destination for events. */
export interface EventSink {
  name: string
  /** Events this sink wants; empty means all of them */
  events?: Array<keyof BuddyEvents>
  deliver: <K extends keyof BuddyEvents>(event: K, payload: BuddyEvents[K]) => Promise<void>
}

/**
 * Fan events out to configured sinks.
 *
 * Delivery failures are contained per sink: a Slack outage must not fail the
 * dependency update that triggered the notification, and one broken webhook
 * must not stop the others from firing.
 */
export class EventBus {
  private readonly sinks: EventSink[] = []

  constructor(private readonly logger: Logger = getDefaultLogger()) {}

  /** Register a destination. */
  register(sink: EventSink): void {
    this.sinks.push(sink)
  }

  /** How many sinks are registered. */
  get size(): number {
    return this.sinks.length
  }

  /**
   * Emit an event to every interested sink.
   *
   * Sinks run concurrently and their failures are swallowed after logging —
   * notification is a side effect of the work, never a precondition for it.
   *
   * @param event - Event name
   * @param payload - Event payload
   */
  async emit<K extends keyof BuddyEvents>(event: K, payload: BuddyEvents[K]): Promise<void> {
    const interested = this.sinks.filter(sink => !sink.events?.length || sink.events.includes(event))
    if (interested.length === 0)
      return

    await Promise.all(interested.map(async (sink) => {
      try {
        await sink.deliver(event, payload)
        this.logger.debug(`📣 Delivered ${event} to ${sink.name}`)
      }
      catch (error) {
        this.logger.warn(`⚠️ Could not deliver ${event} to ${sink.name}: ${error}`)
      }
    }))
  }
}

/** Human-readable one-liner for an event, shared by every sink. */
export function describeEvent<K extends keyof BuddyEvents>(event: K, payload: BuddyEvents[K]): string {
  switch (event) {
    case 'scan.completed': {
      const scan = payload as BuddyEvents['scan.completed']
      return `Found ${scan.total} update(s): ${scan.major} major, ${scan.minor} minor, ${scan.patch} patch`
    }
    case 'pr.created': {
      const pr = payload as BuddyEvents['pr.created']
      return `Opened #${pr.number}: ${pr.title}`
    }
    case 'pr.merged': {
      const pr = payload as BuddyEvents['pr.merged']
      return `Merged #${pr.number}: ${pr.title}`
    }
    case 'security.advisories': {
      const advisories = payload as BuddyEvents['security.advisories']
      return `${advisories.packages.length} dependency/dependencies with known advisories`
    }
    case 'run.failed': {
      const failure = payload as BuddyEvents['run.failed']
      return `\`${failure.command}\` failed: ${failure.error}`
    }
    default:
      return event
  }
}
