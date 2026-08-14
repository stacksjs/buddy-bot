import type { Logger } from '../utils/logger'
import { getDefaultLogger } from '../utils/logger'

/**
 * Files whose contents describe how this repository expects code to be written.
 *
 * These are the conventional agent-instruction files, so a repository that
 * already tells another tool its conventions does not have to repeat them.
 */
export const DEFAULT_GUIDELINE_FILES: string[] = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'CONTRIBUTING.md',
]

/** Total guideline text handed to the model, before truncation. */
export const MAX_GUIDELINE_CHARS = 20_000

/** Reads a repository file at a specific ref. */
export type RefFileReader = (path: string, ref: string) => Promise<string | null>

/**
 * Load the repository's coding guidelines.
 *
 * **Always read at the base ref, never the head.** Guideline files are trusted
 * input — they are inlined into the review's system prompt — and reading them
 * from the pull request's own branch would let any contributor rewrite the
 * instructions their code is reviewed against. At the base ref they are
 * commit-reviewed content, which is what makes trusting them defensible.
 *
 * @param read - Reader that fetches a path at a given ref
 * @param baseRef - Branch or SHA to read from, never the PR head
 * @param files - Files to look for; defaults to the conventional set
 * @param logger - Logger for diagnostics
 * @returns Concatenated guidelines, empty when none are found
 * @example
 * ```ts
 * const guidelines = await loadGuidelines(
 *   (path, ref) => provider.getFileContent(path, ref),
 *   'main',
 * )
 * ```
 */
export async function loadGuidelines(
  read: RefFileReader,
  baseRef: string,
  files: string[] | false = DEFAULT_GUIDELINE_FILES,
  logger: Logger = getDefaultLogger(),
): Promise<string> {
  if (files === false)
    return ''

  const sections: string[] = []
  let total = 0

  for (const path of files) {
    let content: string | null = null
    try {
      content = await read(path, baseRef)
    }
    catch (error) {
      logger.debug(`Could not read ${path} at ${baseRef}: ${error}`)
      continue
    }

    if (!content?.trim())
      continue

    const remaining = MAX_GUIDELINE_CHARS - total
    if (remaining <= 0) {
      logger.debug(`Guideline budget exhausted before reading ${path}`)
      break
    }

    const body = content.length > remaining
      ? `${content.slice(0, remaining)}\n… [truncated]`
      : content

    sections.push(`--- ${path} ---\n${body}`)
    total += body.length
  }

  if (sections.length === 0)
    return ''

  logger.debug(`Loaded ${sections.length} guideline file(s), ${total} characters`)

  return sections.join('\n\n')
}

/**
 * Build the instruction block for a review.
 *
 * @param parts - Global instructions, path-specific instructions and guidelines
 * @returns Combined instructions, empty when there is nothing to say
 */
export function composeInstructions(parts: {
  global?: string
  pathInstructions?: string[]
  guidelines?: string
}): string {
  const sections: string[] = []

  if (parts.global?.trim())
    sections.push(parts.global.trim())

  if (parts.pathInstructions?.length)
    sections.push(`Path-specific guidance:\n${parts.pathInstructions.join('\n')}`)

  if (parts.guidelines?.trim()) {
    sections.push(
      `Repository conventions, from its own documentation:\n${parts.guidelines.trim()}`,
    )
  }

  return sections.join('\n\n')
}
