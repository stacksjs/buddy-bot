import type { BuddyBotConfig } from './types'
import process from 'node:process'
import { BUILTIN_ANALYZERS } from './analysis/engine'
import { commandExists } from './analysis/analyzers/external'
import { resolveAiProvider } from './ai/client'
import { validateConfig } from './config-validation'
import { PROVIDER_TOKEN_ENV, resolveProviderToken } from './git/provider'

/** One thing that was checked. */
export interface DoctorCheck {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  /** What to do about it — omitted when there is nothing to do */
  remediation?: string
}

/** Everything that was checked, grouped. */
export interface DoctorReport {
  checks: DoctorCheck[]
  /** Whether anything is broken rather than merely absent */
  healthy: boolean
}

/** Environment the diagnosis reads; injectable so it can be tested. */
export interface DoctorEnvironment {
  env: Record<string, string | undefined>
  cwd: string
  /** Whether a command exists; injected so tests need no real binaries */
  hasCommand: (command: string) => Promise<boolean>
}

/** Analyzers backed by a binary, and the binary each needs. */
const EXTERNAL_TOOLS: Array<[string, string]> = [
  ['actionlint', 'actionlint'],
  ['shellcheck', 'shellcheck'],
  ['hadolint', 'hadolint'],
  ['markdownlint', 'markdownlint'],
]

/**
 * Diagnose this environment.
 *
 * Written to answer the question a support thread actually opens with — "why
 * did nothing happen?" — so every failing check carries the command or the
 * setting that fixes it. A check that reports a problem without saying what to
 * do about it has moved the question rather than answered it.
 *
 * @param config - Loaded configuration
 * @param environment - Environment overrides, defaulting to the real one
 * @returns Every check, and whether anything is actually broken
 * @example
 * ```ts
 * const report = await diagnose(config)
 * console.log(renderDoctorReport(report))
 * ```
 */
export async function diagnose(
  config: BuddyBotConfig,
  environment: Partial<DoctorEnvironment> = {},
): Promise<DoctorReport> {
  const env = environment.env ?? process.env
  const cwd = environment.cwd ?? process.cwd()
  const hasCommand = environment.hasCommand ?? commandExists

  const checks: DoctorCheck[] = []

  // -- Runtime -------------------------------------------------------------

  checks.push({
    name: 'bun',
    status: 'ok',
    detail: `Bun ${Bun.version}`,
  })

  // -- Repository ----------------------------------------------------------

  const isRepo = await Bun.file(`${cwd}/.git/HEAD`).exists()
  checks.push(isRepo
    ? { name: 'git repository', status: 'ok', detail: cwd }
    : {
        name: 'git repository',
        status: 'fail',
        detail: `${cwd} is not a git repository`,
        remediation: 'Run buddy-bot from inside a repository, or run `git init`.',
      })

  // -- Configuration -------------------------------------------------------

  const issues = validateConfig(config)
  checks.push(issues.length === 0
    ? { name: 'configuration', status: 'ok', detail: 'valid' }
    : {
        name: 'configuration',
        status: 'fail',
        detail: `${issues.length} problem(s): ${issues.slice(0, 3).map(issue => `${issue.path} ${issue.message}`).join('; ')}`,
        remediation: 'Fix the paths reported above in buddy-bot.config.ts.',
      })

  const hasRepository = Boolean(config.repository?.owner && config.repository.name)
  checks.push(hasRepository
    ? { name: 'repository config', status: 'ok', detail: `${config.repository!.owner}/${config.repository!.name}` }
    : {
        name: 'repository config',
        status: 'warn',
        detail: 'owner and name are not set',
        remediation: 'Set repository.owner and repository.name, or run in Actions where GITHUB_REPOSITORY is available. Local review works without them.',
      })

  // -- Credentials ---------------------------------------------------------

  const providerName = config.repository?.provider ?? 'github'
  const token = config.repository?.token
    ? { token: config.repository.token, source: 'repository.token' }
    : resolveProviderToken(providerName as 'github', env)

  checks.push(token
    ? { name: 'git token', status: 'ok', detail: `found in ${token.source}` }
    : {
        name: 'git token',
        status: 'warn',
        detail: 'no token found',
        remediation: `Set one of ${(PROVIDER_TOKEN_ENV[providerName as 'github'] ?? []).join(', ')}. Local review does not need one.`,
      })

  const ai = resolveAiProvider(config, env)
  checks.push(ai
    ? { name: 'ai provider', status: 'ok', detail: `${ai.provider} via ${ai.apiKeyEnv}` }
    : {
        name: 'ai provider',
        status: 'warn',
        detail: 'no API key found',
        remediation: 'Set ANTHROPIC_API_KEY (or OPENAI_API_KEY / GOOGLE_API_KEY). Dependency updates and static analysis work without one.',
      })

  // -- Analyzer tooling ----------------------------------------------------

  for (const [analyzer, command] of EXTERNAL_TOOLS) {
    const present = await hasCommand(command)
    checks.push(present
      ? { name: `analyzer: ${analyzer}`, status: 'ok', detail: `${command} found` }
      : {
          name: `analyzer: ${analyzer}`,
          status: 'warn',
          detail: `${command} not installed`,
          remediation: `Install ${command} to enable the ${analyzer} analyzer. Reviews run without it and report it as skipped.`,
        })
  }

  const native = BUILTIN_ANALYZERS
    .filter(analyzer => !EXTERNAL_TOOLS.some(([name]) => name === analyzer.name))
    .map(analyzer => analyzer.name)

  checks.push({
    name: 'native analyzers',
    status: 'ok',
    detail: `${native.join(', ')} — always available`,
  })

  return {
    checks,
    // Warnings are absent optional capabilities, which is a normal state; only
    // a failure means buddy-bot cannot do what it was asked to.
    healthy: !checks.some(check => check.status === 'fail'),
  }
}

const ICONS: Record<DoctorCheck['status'], string> = { ok: '✅', warn: '⚠️ ', fail: '❌' }

/**
 * Render a diagnosis for a terminal.
 *
 * @param report - The diagnosis
 * @returns Human-readable output
 */
export function renderDoctorReport(report: DoctorReport): string {
  const lines: string[] = ['', 'Buddy Bot environment', '']

  for (const check of report.checks) {
    lines.push(`${ICONS[check.status]} ${check.name}: ${check.detail}`)
    if (check.remediation)
      lines.push(`   → ${check.remediation}`)
  }

  const failures = report.checks.filter(check => check.status === 'fail').length
  const warnings = report.checks.filter(check => check.status === 'warn').length

  lines.push('')
  lines.push(report.healthy
    ? `Ready. ${warnings} optional capability/capabilities unavailable.`
    : `${failures} problem(s) must be fixed before buddy-bot can run.`)

  return `${lines.join('\n')}\n`
}
