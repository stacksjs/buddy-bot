import type { ParsedWorkflow } from './types'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseWorkflow } from './parser'

/**
 * Discover every `.github/workflows/*.{yml,yaml}` file under `root` and
 * parse each one. Subdirectories of `workflows/` (composite actions live
 * elsewhere; this is for triggered workflows specifically) are not
 * traversed — GitHub itself only loads top-level files.
 */
export async function loadWorkflows(root: string): Promise<ParsedWorkflow[]> {
  const dir = join(root, '.github', 'workflows')
  if (!existsSync(dir))
    return []

  const entries = readdirSync(dir)
  const out: ParsedWorkflow[] = []

  for (const name of entries) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml'))
      continue

    const full = join(dir, name)
    if (!statSync(full).isFile())
      continue

    const raw = await Bun.file(full).text()
    const parsed = parseWorkflow(relative(root, full), raw)
    if (parsed)
      out.push(parsed)
  }

  return out
}
