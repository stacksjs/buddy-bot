import type { Logger } from '../utils/logger'
import { createPathMatcher } from '../utils/globs'
import { getDefaultLogger } from '../utils/logger'

/** Where learnings live by default, relative to the repository root. */
export const DEFAULT_LEARNINGS_FILE = '.buddy/learnings.jsonl'

/** How many learnings are injected into a prompt before ranking cuts off. */
export const DEFAULT_PROMPT_LIMIT = 20

/** A durable fact recorded for future runs. */
export interface Learning {
  /** Short stable identifier */
  id: string
  /** The fact itself, written for a model to read */
  text: string
  /** Where it applies; empty means everywhere */
  paths?: string[]
  /** Category, e.g. `convention`, `suppression`, `setup` */
  kind?: string
  /** Where it came from, for provenance */
  source?: { pr?: number, issue?: number, comment?: number }
  /** ISO timestamp */
  createdAt: string
}

/**
 * Parse a learnings file.
 *
 * JSONL rather than JSON so appending a learning is a one-line diff a
 * maintainer can review, and one corrupt line loses one learning instead of
 * the whole file.
 *
 * @param content - File contents
 * @returns Every readable learning; unreadable lines are skipped
 */
export function parseLearnings(content: string | null | undefined): Learning[] {
  if (!content)
    return []

  const learnings: Learning[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue

    try {
      const parsed = JSON.parse(trimmed) as Partial<Learning>
      if (typeof parsed.text !== 'string' || !parsed.text.trim())
        continue

      learnings.push({
        id: typeof parsed.id === 'string' ? parsed.id : hashId(parsed.text),
        text: parsed.text.trim(),
        ...(Array.isArray(parsed.paths) ? { paths: parsed.paths.filter(p => typeof p === 'string') } : {}),
        ...(typeof parsed.kind === 'string' ? { kind: parsed.kind } : {}),
        ...(parsed.source && typeof parsed.source === 'object' ? { source: parsed.source } : {}),
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
      })
    }
    catch {
      // One malformed line must not discard the rest of the file.
      continue
    }
  }

  return learnings
}

/** Render learnings back to JSONL. */
export function serializeLearnings(learnings: Learning[]): string {
  return `${learnings.map(entry => JSON.stringify(entry)).join('\n')}\n`
}

/**
 * Build a learning from free text.
 *
 * @param text - The fact to record
 * @param options - Scope, category and provenance
 */
export function createLearning(
  text: string,
  options: { paths?: string[], kind?: string, source?: Learning['source'] } = {},
): Learning {
  return {
    id: hashId(text),
    text: text.trim(),
    ...(options.paths?.length ? { paths: options.paths } : {}),
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.source ? { source: options.source } : {}),
    createdAt: new Date().toISOString(),
  }
}

/**
 * Add a learning, replacing any that says the same thing.
 *
 * Deduplicating on text means a maintainer repeating themselves updates the
 * existing note rather than growing the file with near-copies that each cost
 * prompt budget.
 *
 * @param existing - Current learnings
 * @param learning - Learning to add
 */
export function addLearning(existing: Learning[], learning: Learning): Learning[] {
  return [...existing.filter(entry => entry.id !== learning.id), learning]
}

/**
 * Pick the learnings worth sending for a given set of files.
 *
 * Path-scoped learnings that match rank above unscoped ones, and newer above
 * older, because a note written about the files under review is more likely to
 * matter than a general one written a year ago.
 *
 * @param learnings - Every recorded learning
 * @param files - Files under review; empty selects only unscoped learnings
 * @param limit - Maximum to return
 * @returns The selected learnings, most relevant first
 */
export function selectLearnings(
  learnings: Learning[],
  files: string[],
  limit: number = DEFAULT_PROMPT_LIMIT,
): Learning[] {
  const scored = learnings
    .map((learning) => {
      if (!learning.paths?.length)
        return { learning, score: 1 }

      const matcher = createPathMatcher(learning.paths)
      const matches = files.some(file => matcher.matches(file))
      return { learning, score: matches ? 2 : 0 }
    })
    .filter(entry => entry.score > 0)

  scored.sort((a, b) => {
    if (a.score !== b.score)
      return b.score - a.score
    return b.learning.createdAt.localeCompare(a.learning.createdAt)
  })

  return scored.slice(0, limit).map(entry => entry.learning)
}

/**
 * Render learnings as prompt text.
 *
 * @param learnings - Learnings to include
 */
export function renderLearnings(learnings: Learning[]): string {
  if (learnings.length === 0)
    return ''

  const lines = learnings.map((learning) => {
    const scope = learning.paths?.length ? ` (${learning.paths.join(', ')})` : ''
    return `- ${learning.text}${scope}`
  })

  return `Things this repository has told you before:\n${lines.join('\n')}`
}

/**
 * Load learnings from a repository ref.
 *
 * **Always read at the base ref.** Learnings are injected into prompts as
 * trusted context, so reading them from a pull request's own branch would let
 * a contributor add "approve everything" to the file their PR is reviewed
 * under — the same rule that governs guideline files.
 *
 * @param read - Reader that fetches a path at a given ref
 * @param baseRef - Branch or SHA to read from, never the PR head
 * @param file - Path to the learnings file
 * @param logger - Logger for diagnostics
 */
export async function loadLearnings(
  read: (path: string, ref: string) => Promise<string | null>,
  baseRef: string,
  file: string = DEFAULT_LEARNINGS_FILE,
  logger: Logger = getDefaultLogger(),
): Promise<Learning[]> {
  try {
    const content = await read(file, baseRef)
    const learnings = parseLearnings(content)
    if (learnings.length > 0)
      logger.debug(`🧠 Loaded ${learnings.length} learning(s) from ${file} at ${baseRef}`)
    return learnings
  }
  catch (error) {
    logger.debug(`Could not read ${file} at ${baseRef}: ${error}`)
    return []
  }
}

/** Short, stable identifier derived from a learning's text. */
function hashId(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  let hash = 0
  for (let index = 0; index < normalized.length; index++) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0
  }
  return `l_${Math.abs(hash).toString(36)}`
}
