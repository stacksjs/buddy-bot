import type { Logger } from '../utils/logger'
import { fetchWithTimeout } from '../utils/http'
import { getDefaultLogger } from '../utils/logger'

/** A release cycle, as endoflife.date reports it. */
export interface EolCycle {
  cycle: string
  /** ISO date, `true` when already ended, `false` when it never ends */
  eol: string | boolean
  latest?: string
  /** ISO date support ended, when the product distinguishes it */
  support?: string | boolean
}

/** What is known about a base image's support window. */
export interface EolStatus {
  product: string
  cycle: string
  /** Whether the cycle has passed its end-of-life date */
  eol: boolean
  /** The date it ends or ended, absent when it never does */
  date?: string
  /** Days until end of life; negative when already past */
  daysRemaining?: number
}

/**
 * Docker images whose support windows endoflife.date tracks.
 *
 * Mapped explicitly rather than guessed from the image name: `node` and
 * `nodejs` are the same product under different names, and an image whose
 * product slug is wrong would report a support window belonging to something
 * else entirely.
 */
export const EOL_PRODUCTS: Record<string, string> = {
  'node': 'nodejs',
  'library/node': 'nodejs',
  'python': 'python',
  'library/python': 'python',
  'debian': 'debian',
  'library/debian': 'debian',
  'ubuntu': 'ubuntu',
  'library/ubuntu': 'ubuntu',
  'alpine': 'alpine',
  'library/alpine': 'alpine',
  'php': 'php',
  'library/php': 'php',
  'ruby': 'ruby',
  'library/ruby': 'ruby',
  'golang': 'go',
  'library/golang': 'go',
  'postgres': 'postgresql',
  'library/postgres': 'postgresql',
  'mysql': 'mysql',
  'library/mysql': 'mysql',
  'redis': 'redis',
  'library/redis': 'redis',
  'nginx': 'nginx',
  'library/nginx': 'nginx',
}

/** The endoflife.date product slug for an image, when there is one. */
export function productFor(image: string): string | null {
  const withoutRegistry = image.replace(/^(?:docker\.io|registry-1\.docker\.io)\//, '')
  return EOL_PRODUCTS[withoutRegistry] ?? EOL_PRODUCTS[withoutRegistry.split('/').pop() ?? ''] ?? null
}

/** The release cycle a tag belongs to, e.g. `20.11-alpine` → `20`. */
export function cycleFor(tag: string, cycles: EolCycle[]): EolCycle | null {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(tag.trim())
  if (!match)
    return null

  const parts = match[1].split('.')

  // Longest cycle first, so `3.18` wins over `3` for an Alpine tag that names
  // both — reporting the wrong cycle means reporting the wrong support window.
  for (let length = parts.length; length >= 1; length--) {
    const candidate = parts.slice(0, length).join('.')
    const cycle = cycles.find(entry => entry.cycle === candidate)
    if (cycle)
      return cycle
  }

  return null
}

/**
 * Look up whether a base image's release cycle is past end of life.
 *
 * Container advisories are thin in OSV, so the practical question for a base
 * image is not "does it have a known CVE" but "is anyone still shipping
 * security patches for it". An image on an EOL cycle stops receiving fixes
 * entirely, which is a more consequential fact than any single advisory.
 *
 * @param image - Image name, with or without a registry
 * @param tag - The tag in the file
 * @param options - Clock and logger, injected so results are reproducible
 * @returns The support status, or null when the product is not tracked
 * @example
 * ```ts
 * const status = await checkEol('node', '18-alpine')
 * if (status?.eol)
 *   findings.push(`node:18 reached end of life on ${status.date}`)
 * ```
 */
export async function checkEol(
  image: string,
  tag: string,
  options: { now?: Date, logger?: Logger, baseUrl?: string } = {},
): Promise<EolStatus | null> {
  const logger = options.logger ?? getDefaultLogger()
  const product = productFor(image)
  if (!product)
    return null

  const base = options.baseUrl ?? 'https://endoflife.date'

  const response = await fetchWithTimeout(`${base}/api/${product}.json`, {
    headers: { 'User-Agent': 'buddy-bot', 'Accept': 'application/json' },
  }).catch(() => null)

  if (!response?.ok) {
    logger.debug(`Could not read the support window for ${product}`)
    return null
  }

  const cycles = await response.json().catch(() => null) as EolCycle[] | null
  if (!Array.isArray(cycles))
    return null

  const cycle = cycleFor(tag, cycles)
  if (!cycle)
    return null

  // `false` means the cycle has no announced end; that is not "unknown", it is
  // "supported indefinitely", and reporting it as a risk would be wrong.
  if (cycle.eol === false)
    return { product, cycle: cycle.cycle, eol: false }

  if (cycle.eol === true)
    return { product, cycle: cycle.cycle, eol: true }

  const eolDate = new Date(cycle.eol)
  if (Number.isNaN(eolDate.getTime()))
    return { product, cycle: cycle.cycle, eol: false }

  const now = options.now ?? new Date()
  const daysRemaining = Math.round((eolDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  return {
    product,
    cycle: cycle.cycle,
    eol: daysRemaining < 0,
    date: cycle.eol,
    daysRemaining,
  }
}

/** How soon an approaching end of life is worth mentioning. */
export const EOL_WARNING_DAYS = 90

/**
 * Describe a support status for a pull request or a gate.
 *
 * @param status - The status to describe
 * @returns A sentence, or empty when there is nothing worth saying
 */
export function describeEol(status: EolStatus | null): string {
  if (!status)
    return ''

  if (status.eol) {
    return status.date
      ? `\`${status.product} ${status.cycle}\` reached end of life on ${status.date} and no longer receives security fixes.`
      : `\`${status.product} ${status.cycle}\` has reached end of life and no longer receives security fixes.`
  }

  if (status.daysRemaining !== undefined && status.daysRemaining <= EOL_WARNING_DAYS) {
    return `\`${status.product} ${status.cycle}\` reaches end of life in ${status.daysRemaining} day(s), on ${status.date}.`
  }

  return ''
}
