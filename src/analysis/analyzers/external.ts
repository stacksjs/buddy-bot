import type { FindingSeverity } from '../../review/findings'
import process from 'node:process'

/** What running an external tool produced. */
export interface ToolRun {
  stdout: string
  stderr: string
  exitCode: number
}

/** How long a single analyzer invocation may take. */
export const TOOL_TIMEOUT_MS = 60_000

/**
 * Run an external analyzer.
 *
 * Arguments are passed as an array and never through a shell, so a file path
 * containing shell metacharacters is an argument rather than a command. That
 * matters here more than usual: the paths come from a pull request's diff,
 * which is to say from whoever opened it.
 *
 * A non-zero exit is normal — linters exit non-zero when they find something —
 * so the caller inspects the output rather than the status.
 *
 * @param command - Executable name
 * @param args - Arguments, each passed literally
 * @param cwd - Working directory
 * @returns Captured output and exit status
 */
export async function runTool(command: string, args: string[], cwd: string): Promise<ToolRun> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    // A linter must never inherit the run's credentials: it is third-party
    // code being pointed at attacker-influenced files.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: 'C' },
  })

  const timeout = setTimeout(() => proc.kill(), TOOL_TIMEOUT_MS)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    return { stdout, stderr, exitCode }
  }
  finally {
    clearTimeout(timeout)
  }
}

/**
 * Map a tool's severity vocabulary onto buddy-bot's.
 *
 * Everything a linter calls "style" lands on `nit`, so a formatting opinion
 * cannot outrank a correctness finding in the review's ordering.
 *
 * @param level - The tool's own severity word
 * @returns The corresponding review severity
 */
export function mapSeverity(level: string | number | undefined): FindingSeverity {
  const normalized = String(level ?? '').toLowerCase()

  switch (normalized) {
    case 'error':
    case 'fatal':
    case '2':
      return 'major'
    case 'warning':
    case 'warn':
    case '1':
      return 'minor'
    default:
      return 'nit'
  }
}

/**
 * Parse JSON a tool wrote to stdout.
 *
 * Tools sometimes print a banner or a deprecation notice before their JSON, so
 * the parse starts at the first bracket rather than at byte zero.
 *
 * @param stdout - Raw tool output
 * @returns The parsed value, or null when there is no usable JSON
 */
export function parseToolJson<T>(stdout: string): T | null {
  const start = stdout.search(/[[{]/)
  if (start === -1)
    return null

  try {
    return JSON.parse(stdout.slice(start)) as T
  }
  catch {
    return null
  }
}

/** Normalize a tool's path back to repository-relative. */
export function relativize(path: string, root: string): string {
  const prefix = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\.\//, '')
}

/**
 * Whether a command exists on this runner.
 *
 * Shared by external-tool analyzers so each does not reimplement the probe.
 *
 * @param command - Executable name
 * @returns Whether the command can be resolved on PATH
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', command], {
      stdout: 'ignore',
      stderr: 'ignore',
      // Passed explicitly, and identically to `runTool`: the probe and the
      // invocation must resolve the same binary, or an analyzer reports
      // itself available and then fails to spawn.
      env: { PATH: process.env.PATH ?? '' },
    })
    return await proc.exited === 0
  }
  catch {
    return false
  }
}
