import { Glob } from 'bun'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'

/** Directories never worth walking when looking for manifests. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'vendor',
  'target',
  '.git',
  '.venv',
  'venv',
  'dist',
  'build',
  '__pycache__',
  '.next',
  '.cache',
])

/** Escape a string for use inside a regular expression. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find files matching an adapter's manifest patterns.
 *
 * Depth-limited and skipping build output, because a repository with a
 * `node_modules` or a Rust `target/` contains thousands of manifests that
 * belong to dependencies rather than to the project — proposing updates for
 * those would be proposing to edit vendored code.
 *
 * @param dir - Directory to search
 * @param patterns - Filenames or globs to match against the base name
 * @param maxDepth - How deep to walk (default: 4)
 * @returns Repository-relative paths
 */
export async function detectFiles(dir: string, patterns: string[], maxDepth = 4): Promise<string[]> {
  const globs = patterns.map(pattern => new Glob(pattern))
  const found: string[] = []

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth)
      return

    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      const path = join(current, entry.name)

      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.'))
          await walk(path, depth + 1)
        continue
      }

      const relativePath = relative(dir, path)
      if (globs.some(glob => glob.match(entry.name) || glob.match(relativePath)))
        found.push(relativePath)
    }
  }

  await walk(dir, 0)
  return found.sort()
}

/** A lockfile and the command that regenerates it. */
export interface LockfileCommand {
  lockfile: string
  command: string[]
}

/**
 * Regenerate whichever lockfiles are present and whose tool is installed.
 *
 * Best-effort by design: a runner without `cargo` should still produce a pull
 * request, with a note saying the lockfile needs regenerating. Producing no
 * pull request at all because a toolchain is missing would hide the update
 * entirely, which is strictly worse than an incomplete one that says so.
 *
 * @param dir - Repository root
 * @param candidates - Lockfiles to try, in order
 * @returns Which lockfiles were regenerated, and a note about any that were not
 */
export async function regenerateWith(
  dir: string,
  candidates: LockfileCommand[],
): Promise<{ regenerated: string[], note?: string }> {
  const regenerated: string[] = []
  const missing: string[] = []

  for (const candidate of candidates) {
    if (!(await Bun.file(join(dir, candidate.lockfile)).exists()))
      continue

    const [tool] = candidate.command
    if (!(await commandAvailable(tool))) {
      missing.push(`${candidate.lockfile} (needs \`${candidate.command.join(' ')}\`)`)
      continue
    }

    const proc = Bun.spawn(candidate.command, {
      cwd: dir,
      stdout: 'ignore',
      stderr: 'ignore',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    })

    if (await proc.exited === 0)
      regenerated.push(candidate.lockfile)
    else
      missing.push(`${candidate.lockfile} (\`${candidate.command.join(' ')}\` failed)`)
  }

  return {
    regenerated,
    ...(missing.length > 0
      ? { note: `These lockfiles were not regenerated and need updating locally: ${missing.join(', ')}.` }
      : {}),
  }
}

/** Whether a command exists on this runner. */
export async function commandAvailable(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', command], {
      stdout: 'ignore',
      stderr: 'ignore',
      env: { PATH: process.env.PATH ?? '' },
    })
    return await proc.exited === 0
  }
  catch {
    return false
  }
}

/**
 * Compare two dot-separated numeric versions.
 *
 * Shared by the ecosystems whose ordering really is plain semver, so each
 * adapter does not reimplement it and get a different answer.
 */
export function compareNumeric(a: string, b: string): number {
  const parse = (version: string): number[] =>
    version.replace(/^[^\d]*/, '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0)

  const left = parse(a)
  const right = parse(b)

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0)
      return diff
  }

  return 0
}

/** Classify a change between two dot-separated numeric versions. */
export function numericUpdateType(from: string, to: string): 'major' | 'minor' | 'patch' {
  const parse = (version: string): number[] =>
    version.replace(/^[^\d]*/, '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0)

  const a = parse(from)
  const b = parse(to)

  if ((a[0] ?? 0) !== (b[0] ?? 0))
    return 'major'
  if ((a[1] ?? 0) !== (b[1] ?? 0))
    return 'minor'
  return 'patch'
}
