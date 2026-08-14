import type { AgentTool, AgentToolOutput } from '../types'
import process from 'node:process'
import { redact } from '../../ai/redact'

/** Wall-clock ceiling for a single command. */
const DEFAULT_TIMEOUT_MS = 120_000

/** Cap on captured output, so one command cannot fill the context window. */
const MAX_OUTPUT_CHARS = 30_000

/**
 * Environment variables the sandboxed shell may see.
 *
 * An allowlist rather than a blocklist: a new secret-bearing variable added to
 * CI tomorrow is invisible to the agent by default, whereas a blocklist would
 * leak it until someone remembered to add a rule. Nothing here carries
 * credentials — these are the variables a build genuinely needs to run.
 */
export const SHELL_ENV_ALLOWLIST: string[] = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'SHELL',
  'USER',
  'PWD',
  'NODE_ENV',
  'CI',
  'BUN_INSTALL',
  'XDG_CACHE_HOME',
]

/**
 * Patterns for variables that must never reach the shell, whatever the
 * allowlist says.
 *
 * A second layer purely so that widening the allowlist by mistake cannot
 * expose a credential.
 */
const SECRET_NAME_PATTERN = /_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|CREDENTIALS)$|^(?:GITHUB_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|NPM_TOKEN)$/i

/**
 * Build the environment a sandboxed command runs with.
 *
 * @param base - Environment to filter, defaulting to the current process
 * @param extraAllowed - Additional variable names the caller opted in to
 * @returns Only the allowed, non-secret variables
 * @example
 * ```ts
 * buildShellEnv({ PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_x' })
 * // => { PATH: '/usr/bin' }
 * ```
 */
export function buildShellEnv(
  base: Record<string, string | undefined> = process.env,
  extraAllowed: string[] = [],
): Record<string, string> {
  const allowed = new Set([...SHELL_ENV_ALLOWLIST, ...extraAllowed])
  const env: Record<string, string> = {}

  for (const [name, value] of Object.entries(base)) {
    if (value === undefined)
      continue
    if (!allowed.has(name))
      continue
    // Even an explicitly allowed name is dropped when it looks like a secret.
    if (SECRET_NAME_PATTERN.test(name))
      continue

    env[name] = value
  }

  return env
}

/**
 * Run a shell command inside the workspace with a stripped environment.
 *
 * The command itself is model-supplied and is not parsed or allowlisted — the
 * containment boundary is the environment, the working directory, and the
 * timeout, not the command text. Only modes that grant the `shell` tier get
 * this tool at all.
 */
export const shellTool: AgentTool = {
  name: 'run_command',
  tier: 'shell',
  description:
    'Run a shell command in the repository. The environment is stripped of credentials, '
    + 'so commands cannot authenticate to external services.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to run, e.g. bun test' },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds' },
    },
    required: ['command'],
  },

  async run(input, context): Promise<AgentToolOutput> {
    const command = String(input.command ?? '').trim()
    if (!command)
      return { content: 'No command supplied', isError: true }

    const timeout = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : DEFAULT_TIMEOUT_MS
    context.log(`running: ${command}`)

    try {
      const proc = Bun.spawn(['sh', '-c', command], {
        cwd: context.workspace,
        env: buildShellEnv(),
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const timer = setTimeout(() => proc.kill(), timeout)
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      clearTimeout(timer)

      const combined = [stdout, stderr].filter(Boolean).join('\n').trim()
      const output = combined.length > MAX_OUTPUT_CHARS
        ? `${combined.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated]`
        : combined

      return {
        // Command output can contain anything the command printed, including a
        // credential the command itself echoed.
        content: `exit code ${exitCode}\n\n${redact(output) || '(no output)'}`,
        isError: exitCode !== 0,
      }
    }
    catch (error) {
      return { content: `Command failed: ${redact(String(error))}`, isError: true }
    }
  },
}
