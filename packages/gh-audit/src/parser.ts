import type { ParsedWorkflow, WorkflowData } from './types'

/**
 * Parse a workflow file. Returns `null` if the YAML is unparseable so the
 * caller can carry on with the rest of the suite — broken YAML is the
 * checker's user's problem to fix, not gh-audit's to crash on.
 */
export function parseWorkflow(file: string, raw: string): ParsedWorkflow | null {
  try {
    const data = Bun.YAML.parse(raw) as WorkflowData
    if (!data || typeof data !== 'object')
      return null
    return { file, raw, data }
  }
  catch {
    return null
  }
}

/**
 * Best-effort 1-based line lookup for a literal substring. Used by rules
 * to attach line numbers to findings — `Bun.YAML.parse` strips position
 * info, so we scan the raw text instead. Returns `undefined` when the
 * needle isn't found verbatim (rules then fall back to a file-level
 * finding).
 */
export function findLine(raw: string, needle: string): number | undefined {
  if (!needle)
    return undefined
  const idx = raw.indexOf(needle)
  if (idx < 0)
    return undefined
  // Count newlines before the hit; 1-based.
  let line = 1
  for (let i = 0; i < idx; i++) {
    if (raw.charCodeAt(i) === 10)
      line++
  }
  return line
}
