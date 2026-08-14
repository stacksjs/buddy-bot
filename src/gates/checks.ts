import type { PRManifest } from '../types'

/** How a failing check behaves. */
export type GateMode = 'off' | 'warning' | 'error'

/** The result of one check. */
export interface GateResult {
  name: string
  /** `error` blocks the merge under branch protection; `warning` does not */
  mode: GateMode
  passed: boolean
  /** What failed, or what passed */
  summary: string
  /** Extra explanation shown under the summary */
  detail?: string
}

/** Everything the gates need to evaluate a pull request. */
export interface GateInput {
  title: string
  body: string
  /** Manifest for dependency pull requests, when there is one */
  manifest?: PRManifest | null
  /** Dependencies the change introduces or updates, with their metadata */
  dependencies?: Array<{
    name: string
    version: string
    license?: string
    vulnerable?: boolean
    deprecated?: boolean
    /**
     * Set for a base image whose release cycle no longer receives security
     * fixes. More consequential than any single advisory: an EOL image stops
     * getting patches entirely rather than carrying one known hole.
     */
    eol?: string
  }>
}

/** Configuration for the built-in checks. */
export interface GateConfig {
  titleFormat?: GateMode
  description?: { mode: GateMode, requireSections?: string[] }
  dependencyGate?: {
    mode: GateMode
    licenseAllowlist?: string[]
    blockVulnerable?: boolean
    blockDeprecated?: boolean
    /** Block base images past end of life (default: true) */
    blockEol?: boolean
  }
}

/** Conventional-commit shape, which is what `titleFormat` checks for. */
const CONVENTIONAL_TITLE = /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)]+\))?!?: .+/

/**
 * Check a pull request title against conventional-commit format.
 *
 * @param title - Pull request title
 * @param mode - How a failure behaves
 */
export function checkTitleFormat(title: string, mode: GateMode): GateResult {
  const passed = CONVENTIONAL_TITLE.test(title.trim())

  return {
    name: 'title-format',
    mode,
    passed,
    summary: passed
      ? 'Title follows conventional commit format'
      : 'Title does not follow conventional commit format',
    ...(passed
      ? {}
      : { detail: 'Expected something like `feat(scope): add the thing` or `fix: correct the off-by-one`.' }),
  }
}

/**
 * Check that a description is present and covers the required sections.
 *
 * @param body - Pull request body
 * @param options - Mode and the sections that must appear
 */
export function checkDescription(
  body: string,
  options: { mode: GateMode, requireSections?: string[] },
): GateResult {
  const text = body.trim()

  if (text.length < 20) {
    return {
      name: 'description',
      mode: options.mode,
      passed: false,
      summary: 'Description is missing or too short',
      detail: 'Explain what changed and why, so a reviewer does not have to reconstruct it from the diff.',
    }
  }

  const missing = (options.requireSections ?? []).filter(
    section => !new RegExp(`^#{1,6}\\s*${escapeRegExp(section)}\\b`, 'im').test(text),
  )

  return {
    name: 'description',
    mode: options.mode,
    passed: missing.length === 0,
    summary: missing.length === 0
      ? 'Description is complete'
      : `Description is missing ${missing.length} required section(s)`,
    ...(missing.length > 0 ? { detail: `Missing: ${missing.map(section => `\`${section}\``).join(', ')}` } : {}),
  }
}

/**
 * Check the dependencies a change introduces.
 *
 * Runs with no API key and no model: the vulnerability, deprecation and
 * license facts all come from data buddy-bot already collects, which makes
 * this the gate a repository gets for free.
 *
 * @param dependencies - Dependencies introduced or updated
 * @param options - Mode and policy
 */
export function checkDependencies(
  dependencies: GateInput['dependencies'],
  options: NonNullable<GateConfig['dependencyGate']>,
): GateResult {
  const problems: string[] = []

  for (const dependency of dependencies ?? []) {
    if (options.blockVulnerable !== false && dependency.vulnerable)
      problems.push(`\`${dependency.name}@${dependency.version}\` has a known vulnerability`)

    if (options.blockDeprecated !== false && dependency.deprecated)
      problems.push(`\`${dependency.name}\` is deprecated`)

    if (options.blockEol !== false && dependency.eol)
      problems.push(dependency.eol)

    if (options.licenseAllowlist?.length && dependency.license) {
      // An unknown license is reported rather than assumed acceptable: the
      // point of an allowlist is that anything not on it needs a decision.
      if (!options.licenseAllowlist.includes(dependency.license))
        problems.push(`\`${dependency.name}\` is licensed \`${dependency.license}\`, which is not on the allowlist`)
    }
  }

  return {
    name: 'dependency-gate',
    mode: options.mode,
    passed: problems.length === 0,
    summary: problems.length === 0
      ? 'Dependencies satisfy the configured policy'
      : `${problems.length} dependency policy violation(s)`,
    ...(problems.length > 0 ? { detail: problems.map(problem => `- ${problem}`).join('\n') } : {}),
  }
}

/**
 * Run every configured check.
 *
 * @param input - Pull request under evaluation
 * @param config - Which checks to run and how failures behave
 * @returns Results for the checks that ran, in configuration order
 */
export function runGates(input: GateInput, config: GateConfig): GateResult[] {
  const results: GateResult[] = []

  if (config.titleFormat && config.titleFormat !== 'off')
    results.push(checkTitleFormat(input.title, config.titleFormat))

  if (config.description && config.description.mode !== 'off')
    results.push(checkDescription(input.body, config.description))

  if (config.dependencyGate && config.dependencyGate.mode !== 'off')
    results.push(checkDependencies(input.dependencies, config.dependencyGate))

  return results
}

/**
 * Overall conclusion for a check run.
 *
 * Only an `error`-mode failure blocks; a `warning` failure reports without
 * turning the check red, which is what makes a gate adoptable before a team
 * has agreed to enforce it.
 *
 * @param results - Results from {@link runGates}
 */
export function summarizeGates(results: GateResult[]): {
  conclusion: 'success' | 'failure' | 'neutral'
  title: string
  summary: string
} {
  if (results.length === 0)
    return { conclusion: 'neutral', title: 'No checks configured', summary: 'No pre-merge checks are enabled.' }

  const blocking = results.filter(result => !result.passed && result.mode === 'error')
  const warnings = results.filter(result => !result.passed && result.mode === 'warning')

  const lines = results.map((result) => {
    const icon = result.passed ? '✅' : result.mode === 'error' ? '❌' : '⚠️'
    return `${icon} **${result.name}** — ${result.summary}${result.detail ? `\n\n${result.detail}\n` : ''}`
  })

  const title = blocking.length > 0
    ? `${blocking.length} check(s) failed`
    : warnings.length > 0
      ? `${warnings.length} warning(s)`
      : 'All checks passed'

  return {
    conclusion: blocking.length > 0 ? 'failure' : 'success',
    title,
    summary: lines.join('\n\n'),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
