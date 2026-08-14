import type { BuddyBotConfig } from './types'
import type { GitProviderName } from './git/provider'
import { BUILTIN_ANALYZERS } from './analysis/engine'
import { IMPLEMENTED_PROVIDERS, PROVIDER_TRACKING_ISSUES } from './git/provider'
import { ConfigurationError } from './types'

const UPDATE_STRATEGIES = ['major', 'minor', 'patch', 'all'] as const
const MERGE_STRATEGIES = ['merge', 'squash', 'rebase'] as const
const AUTO_MERGE_CONDITIONS = ['patch-only', 'minor-only', 'security-only', 'all'] as const
const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter', 'openai-compatible'] as const
const AI_EFFORTS = ['low', 'medium', 'high'] as const
const REVIEW_PROFILES = ['chill', 'assertive'] as const
const REQUEST_CHANGES_MODES = ['never', 'critical'] as const
const SEVERITIES = ['low', 'moderate', 'high', 'critical'] as const
const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const
const RULE_ECOSYSTEMS = ['npm', 'composer', 'github-actions', 'docker', 'pkgx', 'zig', 'python', 'rust', 'go', 'ruby'] as const
const RULE_UPDATE_TYPES = ['major', 'minor', 'patch'] as const
const ANALYZER_NAMES: string[] = BUILTIN_ANALYZERS.map(analyzer => analyzer.name)

/** A single problem found in a loaded configuration. */
export interface ConfigIssue {
  /** Dotted path to the offending key, e.g. `packages.groups[0].patterns` */
  path: string
  /** What is wrong and what was expected */
  message: string
}

function quote(value: unknown): string {
  return JSON.stringify(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Collect issues for a value that must be one of a fixed set of strings. */
function checkEnum<T extends string>(
  issues: ConfigIssue[],
  path: string,
  value: unknown,
  allowed: readonly T[],
): void {
  if (value === undefined)
    return
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    issues.push({
      path,
      message: `expected one of ${allowed.map(quote).join(', ')}, got ${quote(value)}`,
    })
  }
}

/** Collect issues for a value that must be a non-negative finite number. */
function checkNumber(
  issues: ConfigIssue[],
  path: string,
  value: unknown,
  options: { min?: number, integer?: boolean } = {},
): void {
  const min = options.min ?? 0
  const integer = options.integer ?? false

  if (value === undefined)
    return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    issues.push({ path, message: `expected a number >= ${min}, got ${quote(value)}` })
    return
  }
  if (integer && !Number.isInteger(value))
    issues.push({ path, message: `expected a whole number, got ${quote(value)}` })
}

/** Collect issues for a value that must be an array drawn from a fixed set. */
function checkArrayEnum<T extends string>(
  issues: ConfigIssue[],
  path: string,
  value: unknown,
  allowed: readonly T[],
): void {
  if (value === undefined)
    return
  if (!Array.isArray(value)) {
    issues.push({ path, message: `expected an array, got ${quote(value)}` })
    return
  }
  value.forEach((entry, index) => checkEnum(issues, `${path}[${index}]`, entry, allowed))
}

/** Collect issues for a value that must be an array of non-empty strings. */
function checkStringArray(issues: ConfigIssue[], path: string, value: unknown): void {
  if (value === undefined)
    return
  if (!Array.isArray(value)) {
    issues.push({ path, message: `expected an array of strings, got ${quote(value)}` })
    return
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim())
      issues.push({ path: `${path}[${index}]`, message: `expected a non-empty string, got ${quote(entry)}` })
  })
}

/** Collect issues for a value that must be an absolute http(s) URL. */
function checkUrl(issues: ConfigIssue[], path: string, value: unknown): void {
  if (value === undefined)
    return
  if (typeof value !== 'string') {
    issues.push({ path, message: `expected a URL string, got ${quote(value)}` })
    return
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      issues.push({ path, message: `expected an http(s) URL, got ${quote(value)}` })
  }
  catch {
    issues.push({ path, message: `expected a valid absolute URL, got ${quote(value)}` })
  }
}

/**
 * Validate a cron expression's shape.
 *
 * Deliberately structural rather than semantic: the schedule is handed to
 * GitHub Actions or the local scheduler, which do the real parsing. Catching
 * a wrong field count here turns a silently-never-runs workflow into a
 * startup error.
 */
function checkCron(issues: ConfigIssue[], path: string, value: unknown): void {
  if (value === undefined)
    return
  if (typeof value !== 'string' || !value.trim()) {
    issues.push({ path, message: `expected a cron expression string, got ${quote(value)}` })
    return
  }
  const fields = value.trim().split(/\s+/)
  if (fields.length !== 5 && fields.length !== 6) {
    issues.push({
      path,
      message: `expected 5 or 6 whitespace-separated fields, got ${fields.length} (${quote(value)})`,
    })
  }
}

/**
 * Check a loaded configuration for values that would otherwise fail silently.
 *
 * The loader merges user config over defaults without any schema, so a typo
 * like `strategy: 'minr'` or `groups: { … }` instead of an array produces a
 * run that quietly does the wrong thing. This surfaces those as errors before
 * any network or git work happens.
 *
 * @param config - Configuration to check
 * @returns Every problem found, empty when the config is valid
 * @example
 * ```ts
 * const issues = validateConfig(config)
 * if (issues.length > 0)
 *   console.error(formatConfigIssues(issues))
 * ```
 */
export function validateConfig(config: BuddyBotConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []

  if (config.verbose !== undefined && typeof config.verbose !== 'boolean')
    issues.push({ path: 'verbose', message: `expected a boolean, got ${quote(config.verbose)}` })

  checkEnum(issues, 'logLevel', config.logLevel, LOG_LEVELS)

  checkNumber(issues, 'maxPRsPerRun', config.maxPRsPerRun, { min: 1, integer: true })

  validateRepository(issues, config)
  validatePackages(issues, config)
  validatePullRequest(issues, config)
  validateRegistries(issues, config)
  validateSecurity(issues, config)
  validateSchedules(issues, config)
  validateReleaseNotes(issues, config)
  validateDashboard(issues, config)
  validateAi(issues, config)
  validateAnalysis(issues, config)

  return issues
}

function validateDockerRegistries(issues: ConfigIssue[], docker: unknown): void {
  if (docker === undefined)
    return
  if (!isPlainObject(docker)) {
    issues.push({ path: 'registries.docker', message: `expected an object keyed by registry host, got ${quote(docker)}` })
    return
  }

  for (const [host, auth] of Object.entries(docker)) {
    const base = `registries.docker.${host}`
    if (!isPlainObject(auth)) {
      issues.push({ path: base, message: `expected an object, got ${quote(auth)}` })
      continue
    }

    for (const key of ['username', 'passwordEnv', 'tokenEnv'] as const) {
      const value = auth[key]
      if (value !== undefined && (typeof value !== 'string' || !value.trim()))
        issues.push({ path: `${base}.${key}`, message: `expected a non-empty string, got ${quote(value)}` })
    }

    // A username with no password names half a credential, which fails at the
    // registry rather than here unless it is caught.
    if (auth.username && !auth.passwordEnv && !auth.tokenEnv)
      issues.push({ path: `${base}.passwordEnv`, message: 'is required when a username is given' })

    if (auth.passwordEnv && !auth.username)
      issues.push({ path: `${base}.username`, message: 'is required when passwordEnv is given' })
  }
}

function validateAnalysis(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const analysis = config.analysis
  if (analysis === undefined)
    return
  if (!isPlainObject(analysis)) {
    issues.push({ path: 'analysis', message: `expected an object, got ${quote(analysis)}` })
    return
  }

  if (analysis.enabled !== undefined && typeof analysis.enabled !== 'boolean')
    issues.push({ path: 'analysis.enabled', message: `expected a boolean, got ${quote(analysis.enabled)}` })

  if (analysis.tools === undefined)
    return
  if (!isPlainObject(analysis.tools)) {
    issues.push({ path: 'analysis.tools', message: `expected an object mapping analyzer names to booleans, got ${quote(analysis.tools)}` })
    return
  }

  for (const [name, value] of Object.entries(analysis.tools)) {
    if (typeof value !== 'boolean')
      issues.push({ path: `analysis.tools.${name}`, message: `expected a boolean, got ${quote(value)}` })
    else if (!ANALYZER_NAMES.includes(name))
      // A misspelled analyzer name silently leaves that analyzer enabled,
      // which reads as "I turned it off" until it comments on something.
      issues.push({ path: `analysis.tools.${name}`, message: `unknown analyzer; expected one of ${ANALYZER_NAMES.map(quote).join(', ')}` })
  }
}

function validateRepository(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const repository = config.repository
  if (repository === undefined)
    return
  if (!isPlainObject(repository)) {
    issues.push({ path: 'repository', message: `expected an object, got ${quote(repository)}` })
    return
  }

  if (repository.provider !== undefined && !IMPLEMENTED_PROVIDERS.includes(repository.provider as GitProviderName)) {
    // A provider that is planned but unbuilt gets its tracking issue rather
    // than a bare "unsupported", so the user finds the thread instead of
    // filing a duplicate.
    const tracking = PROVIDER_TRACKING_ISSUES[String(repository.provider)]
    issues.push({
      path: 'repository.provider',
      message: tracking
        ? `${quote(repository.provider)} support is not implemented yet — follow ${tracking}`
        : `only ${IMPLEMENTED_PROVIDERS.map(quote).join(', ')} is supported, got ${quote(repository.provider)}`,
    })
  }

  for (const key of ['owner', 'name', 'baseBranch', 'token'] as const) {
    const value = repository[key]
    if (value !== undefined && typeof value !== 'string')
      issues.push({ path: `repository.${key}`, message: `expected a string, got ${quote(value)}` })
  }

  checkUrl(issues, 'repository.apiUrl', repository.apiUrl)
  checkUrl(issues, 'repository.serverUrl', repository.serverUrl)
}

function validatePackages(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const packages = config.packages
  if (packages === undefined)
    return
  if (!isPlainObject(packages)) {
    issues.push({ path: 'packages', message: `expected an object, got ${quote(packages)}` })
    return
  }

  checkEnum(issues, 'packages.strategy', packages.strategy, UPDATE_STRATEGIES)
  checkStringArray(issues, 'packages.ignore', packages.ignore)
  checkStringArray(issues, 'packages.ignorePaths', packages.ignorePaths)
  checkStringArray(issues, 'packages.minimumReleaseAgeExclude', packages.minimumReleaseAgeExclude)
  checkNumber(issues, 'packages.minimumReleaseAge', packages.minimumReleaseAge, { min: 0 })

  for (const key of ['includePrerelease', 'excludeMajor', 'respectLatest'] as const) {
    const value = packages[key]
    if (value !== undefined && typeof value !== 'boolean')
      issues.push({ path: `packages.${key}`, message: `expected a boolean, got ${quote(value)}` })
  }

  if (packages.pin !== undefined) {
    if (!isPlainObject(packages.pin)) {
      issues.push({ path: 'packages.pin', message: `expected an object mapping package names to versions, got ${quote(packages.pin)}` })
    }
    else {
      for (const [name, version] of Object.entries(packages.pin)) {
        if (typeof version !== 'string' || !version.trim())
          issues.push({ path: `packages.pin.${name}`, message: `expected a version string, got ${quote(version)}` })
      }
    }
  }

  if (packages.groups !== undefined) {
    if (!Array.isArray(packages.groups)) {
      issues.push({ path: 'packages.groups', message: `expected an array of groups, got ${quote(packages.groups)}` })
      return
    }
    packages.groups.forEach((group, index) => {
      const base = `packages.groups[${index}]`
      if (!isPlainObject(group)) {
        issues.push({ path: base, message: `expected an object, got ${quote(group)}` })
        return
      }
      if (typeof group.name !== 'string' || !group.name.trim())
        issues.push({ path: `${base}.name`, message: `expected a non-empty string, got ${quote(group.name)}` })

      if (!Array.isArray(group.patterns) || group.patterns.length === 0) {
        issues.push({
          path: `${base}.patterns`,
          message: `expected a non-empty array of patterns, got ${quote(group.patterns)}`,
        })
      }
      else {
        checkStringArray(issues, `${base}.patterns`, group.patterns)
      }

      checkEnum(issues, `${base}.strategy`, group.strategy, UPDATE_STRATEGIES)
    })
  }

  validateRules(issues, packages.rules)
}

const RULE_MATCHERS = [
  'matchPackages',
  'matchEcosystems',
  'matchDepTypes',
  'matchUpdateTypes',
  'matchFiles',
  'matchCurrentVersion',
  'schedule',
] as const

const RULE_EFFECTS = [
  'enabled',
  'strategy',
  'groupName',
  'labels',
  'reviewers',
  'assignees',
  'autoMerge',
  'autoMigrate',
  'minimumReleaseAge',
  'prPriority',
  'scheduleTimezone',
] as const

/**
 * Validate `packages.rules`.
 *
 * A rule that matches nothing is inert and a rule that matches everything is
 * a footgun, so both get caught here rather than at the point some package
 * silently fails to update.
 */
function validateRules(issues: ConfigIssue[], rules: unknown): void {
  if (rules === undefined)
    return
  if (!Array.isArray(rules)) {
    issues.push({ path: 'packages.rules', message: `expected an array of rules, got ${quote(rules)}` })
    return
  }

  const known = new Set<string>([...RULE_MATCHERS, ...RULE_EFFECTS])

  rules.forEach((rule, index) => {
    const base = `packages.rules[${index}]`
    if (!isPlainObject(rule)) {
      issues.push({ path: base, message: `expected an object, got ${quote(rule)}` })
      return
    }

    for (const key of Object.keys(rule)) {
      if (!known.has(key)) {
        // A typo'd matcher is worse than an error: the rule still applies, it
        // just applies to everything.
        issues.push({ path: `${base}.${key}`, message: `unknown key; expected one of ${[...known].map(quote).join(', ')}` })
      }
    }

    const hasMatcher = RULE_MATCHERS.some(matcher => rule[matcher] !== undefined)
    if (!hasMatcher) {
      issues.push({
        path: base,
        message: 'has no matchers, so it applies to every update — add `matchPackages: ["*"]` if that is intended',
      })
    }

    checkStringArray(issues, `${base}.matchPackages`, rule.matchPackages)
    checkStringArray(issues, `${base}.matchDepTypes`, rule.matchDepTypes)
    checkStringArray(issues, `${base}.matchFiles`, rule.matchFiles)
    checkStringArray(issues, `${base}.labels`, rule.labels)
    checkStringArray(issues, `${base}.reviewers`, rule.reviewers)
    checkStringArray(issues, `${base}.assignees`, rule.assignees)

    checkArrayEnum(issues, `${base}.matchEcosystems`, rule.matchEcosystems, RULE_ECOSYSTEMS)
    checkArrayEnum(issues, `${base}.matchUpdateTypes`, rule.matchUpdateTypes, RULE_UPDATE_TYPES)
    checkEnum(issues, `${base}.strategy`, rule.strategy, UPDATE_STRATEGIES)
    checkNumber(issues, `${base}.minimumReleaseAge`, rule.minimumReleaseAge, { min: 0 })

    if (rule.prPriority !== undefined && typeof rule.prPriority !== 'number')
      issues.push({ path: `${base}.prPriority`, message: `expected a number, got ${quote(rule.prPriority)}` })

    for (const key of ['enabled', 'autoMerge', 'autoMigrate'] as const) {
      if (rule[key] !== undefined && typeof rule[key] !== 'boolean')
        issues.push({ path: `${base}.${key}`, message: `expected a boolean, got ${quote(rule[key])}` })
    }

    for (const key of ['groupName', 'matchCurrentVersion', 'scheduleTimezone'] as const) {
      if (rule[key] !== undefined && (typeof rule[key] !== 'string' || !String(rule[key]).trim()))
        issues.push({ path: `${base}.${key}`, message: `expected a non-empty string, got ${quote(rule[key])}` })
    }

    checkCron(issues, `${base}.schedule`, rule.schedule)
  })
}

function validatePullRequest(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const pullRequest = config.pullRequest
  if (pullRequest === undefined)
    return
  if (!isPlainObject(pullRequest)) {
    issues.push({ path: 'pullRequest', message: `expected an object, got ${quote(pullRequest)}` })
    return
  }

  checkStringArray(issues, 'pullRequest.reviewers', pullRequest.reviewers)
  checkStringArray(issues, 'pullRequest.assignees', pullRequest.assignees)
  checkStringArray(issues, 'pullRequest.labels', pullRequest.labels)

  const autoMerge = pullRequest.autoMerge
  if (autoMerge !== undefined) {
    if (!isPlainObject(autoMerge)) {
      issues.push({ path: 'pullRequest.autoMerge', message: `expected an object, got ${quote(autoMerge)}` })
      return
    }
    if (autoMerge.enabled !== undefined && typeof autoMerge.enabled !== 'boolean') {
      issues.push({
        path: 'pullRequest.autoMerge.enabled',
        message: `expected a boolean, got ${quote(autoMerge.enabled)}`,
      })
    }
    checkEnum(issues, 'pullRequest.autoMerge.strategy', autoMerge.strategy, MERGE_STRATEGIES)
    checkStringArray(issues, 'pullRequest.autoMerge.conditions', autoMerge.conditions)

    // Unknown conditions are rejected rather than ignored: silently dropping
    // a misspelled `patch_only` would widen what merges without review.
    if (Array.isArray(autoMerge.conditions)) {
      for (const [index, condition] of autoMerge.conditions.entries()) {
        checkEnum(issues, `pullRequest.autoMerge.conditions[${index}]`, condition, AUTO_MERGE_CONDITIONS)
      }
    }

    if (autoMerge.requireGreenCI !== undefined && typeof autoMerge.requireGreenCI !== 'boolean') {
      issues.push({
        path: 'pullRequest.autoMerge.requireGreenCI',
        message: `expected a boolean, got ${quote(autoMerge.requireGreenCI)}`,
      })
    }

    if (autoMerge.optOutLabel !== undefined && typeof autoMerge.optOutLabel !== 'string') {
      issues.push({
        path: 'pullRequest.autoMerge.optOutLabel',
        message: `expected a string, got ${quote(autoMerge.optOutLabel)}`,
      })
    }
  }
}

function validateAi(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const ai = config.ai
  if (ai === undefined)
    return

  if (!isPlainObject(ai)) {
    issues.push({ path: 'ai', message: `expected an object, got ${quote(ai)}` })
    return
  }

  if (ai.enabled !== undefined && typeof ai.enabled !== 'boolean')
    issues.push({ path: 'ai.enabled', message: `expected a boolean, got ${quote(ai.enabled)}` })

  checkEnum(issues, 'ai.provider', ai.provider, AI_PROVIDERS)
  checkEnum(issues, 'ai.effort', ai.effort, AI_EFFORTS)

  for (const key of ['model', 'apiKeyEnv', 'baseUrl'] as const) {
    if (ai[key] !== undefined && typeof ai[key] !== 'string')
      issues.push({ path: `ai.${key}`, message: `expected a string, got ${quote(ai[key])}` })
  }

  // A key inline in config would be committed to the repository; the option
  // names an environment variable instead, so reject anything key-shaped.
  if (typeof ai.apiKeyEnv === 'string' && /^sk-|^AIza/.test(ai.apiKeyEnv)) {
    issues.push({
      path: 'ai.apiKeyEnv',
      message: 'expected the NAME of an environment variable, not an API key',
    })
  }

  const review = ai.review as Record<string, unknown> | undefined
  if (review !== undefined) {
    if (!isPlainObject(review)) {
      issues.push({ path: 'ai.review', message: `expected an object, got ${quote(review)}` })
    }
    else {
      for (const key of ['enabled', 'drafts', 'autoReview', 'summaryOnly'] as const) {
        if (review[key] !== undefined && typeof review[key] !== 'boolean')
          issues.push({ path: `ai.review.${key}`, message: `expected a boolean, got ${quote(review[key])}` })
      }

      checkEnum(issues, 'ai.review.profile', review.profile, REVIEW_PROFILES)
      checkEnum(issues, 'ai.review.requestChangesOn', review.requestChangesOn, REQUEST_CHANGES_MODES)
      checkStringArray(issues, 'ai.review.ignoreTitleKeywords', review.ignoreTitleKeywords)
      checkStringArray(issues, 'ai.review.ignoreUsernames', review.ignoreUsernames)
      checkStringArray(issues, 'ai.review.pathFilters', review.pathFilters)

      if (review.instructions !== undefined && typeof review.instructions !== 'string')
        issues.push({ path: 'ai.review.instructions', message: `expected a string, got ${quote(review.instructions)}` })

      // `false` disables guideline loading; anything else must be a path list.
      if (review.guidelineFiles !== undefined && review.guidelineFiles !== false)
        checkStringArray(issues, 'ai.review.guidelineFiles', review.guidelineFiles)

      if (review.pathInstructions !== undefined) {
        if (!Array.isArray(review.pathInstructions)) {
          issues.push({
            path: 'ai.review.pathInstructions',
            message: `expected an array, got ${quote(review.pathInstructions)}`,
          })
        }
        else {
          review.pathInstructions.forEach((entry: unknown, index: number) => {
            const base = `ai.review.pathInstructions[${index}]`
            if (!isPlainObject(entry)) {
              issues.push({ path: base, message: `expected an object, got ${quote(entry)}` })
              return
            }
            for (const key of ['path', 'instructions'] as const) {
              if (typeof entry[key] !== 'string' || !entry[key].trim())
                issues.push({ path: `${base}.${key}`, message: `expected a non-empty string, got ${quote(entry[key])}` })
            }
          })
        }
      }
    }
  }

  if (ai.maxTokensPerRun !== undefined) {
    if (typeof ai.maxTokensPerRun !== 'number' || !Number.isFinite(ai.maxTokensPerRun) || ai.maxTokensPerRun <= 0) {
      issues.push({
        path: 'ai.maxTokensPerRun',
        message: `expected a positive number, got ${quote(ai.maxTokensPerRun)}`,
      })
    }
  }
}

function validateRegistries(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const registries = config.registries
  if (registries === undefined)
    return
  if (!isPlainObject(registries)) {
    issues.push({ path: 'registries', message: `expected an object, got ${quote(registries)}` })
    return
  }

  validateDockerRegistries(issues, registries.docker)
  checkUrl(issues, 'registries.npm', registries.npm)
  checkUrl(issues, 'registries.composer', registries.composer)

  if (registries.npmScopes !== undefined) {
    if (!isPlainObject(registries.npmScopes)) {
      issues.push({ path: 'registries.npmScopes', message: `expected an object keyed by scope, got ${quote(registries.npmScopes)}` })
      return
    }
    for (const [scope, url] of Object.entries(registries.npmScopes)) {
      if (!scope.startsWith('@'))
        issues.push({ path: `registries.npmScopes.${scope}`, message: `scope keys must start with "@", got ${quote(scope)}` })
      checkUrl(issues, `registries.npmScopes.${scope}`, url)
    }
  }
}

function validateSecurity(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const security = config.security
  if (security === undefined)
    return
  if (!isPlainObject(security)) {
    issues.push({ path: 'security', message: `expected an object, got ${quote(security)}` })
    return
  }

  for (const key of ['enabled', 'prioritize'] as const) {
    const value = security[key]
    if (value !== undefined && typeof value !== 'boolean')
      issues.push({ path: `security.${key}`, message: `expected a boolean, got ${quote(value)}` })
  }
  if (security.label !== undefined && (typeof security.label !== 'string' || !security.label.trim()))
    issues.push({ path: 'security.label', message: `expected a non-empty string, got ${quote(security.label)}` })

  checkEnum(issues, 'security.minimumSeverity', security.minimumSeverity, SEVERITIES)
}

function validateSchedules(issues: ConfigIssue[], config: BuddyBotConfig): void {
  if (config.schedule !== undefined) {
    if (!isPlainObject(config.schedule)) {
      issues.push({ path: 'schedule', message: `expected an object, got ${quote(config.schedule)}` })
    }
    else {
      checkCron(issues, 'schedule.cron', config.schedule.cron)
      if (config.schedule.timezone !== undefined && typeof config.schedule.timezone !== 'string')
        issues.push({ path: 'schedule.timezone', message: `expected a string, got ${quote(config.schedule.timezone)}` })
    }
  }

  const custom = config.workflows?.custom
  if (custom === undefined)
    return
  if (!Array.isArray(custom)) {
    issues.push({ path: 'workflows.custom', message: `expected an array, got ${quote(custom)}` })
    return
  }
  custom.forEach((workflow, index) => {
    const base = `workflows.custom[${index}]`
    if (!isPlainObject(workflow)) {
      issues.push({ path: base, message: `expected an object, got ${quote(workflow)}` })
      return
    }
    if (typeof workflow.name !== 'string' || !workflow.name.trim())
      issues.push({ path: `${base}.name`, message: `expected a non-empty string, got ${quote(workflow.name)}` })
    checkCron(issues, `${base}.schedule`, workflow.schedule)
    checkEnum(issues, `${base}.strategy`, workflow.strategy, UPDATE_STRATEGIES)
    checkStringArray(issues, `${base}.reviewers`, workflow.reviewers)
    checkStringArray(issues, `${base}.assignees`, workflow.assignees)
    checkStringArray(issues, `${base}.labels`, workflow.labels)
  })
}

function validateReleaseNotes(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const releaseNotes = config.releaseNotes
  if (releaseNotes === undefined)
    return
  if (!isPlainObject(releaseNotes)) {
    issues.push({ path: 'releaseNotes', message: `expected an object, got ${quote(releaseNotes)}` })
    return
  }

  for (const key of ['enabled', 'sanitizeReferences', 'includeCompareLinks'] as const) {
    const value = releaseNotes[key]
    if (value !== undefined && typeof value !== 'boolean')
      issues.push({ path: `releaseNotes.${key}`, message: `expected a boolean, got ${quote(value)}` })
  }
  checkNumber(issues, 'releaseNotes.maxReleases', releaseNotes.maxReleases, { min: 1, integer: true })
  checkNumber(issues, 'releaseNotes.maxBodyLength', releaseNotes.maxBodyLength, { min: 1, integer: true })
}

function validateDashboard(issues: ConfigIssue[], config: BuddyBotConfig): void {
  const dashboard = config.dashboard
  if (dashboard === undefined)
    return
  if (!isPlainObject(dashboard)) {
    issues.push({ path: 'dashboard', message: `expected an object, got ${quote(dashboard)}` })
    return
  }

  checkStringArray(issues, 'dashboard.labels', dashboard.labels)
  checkStringArray(issues, 'dashboard.assignees', dashboard.assignees)
  checkNumber(issues, 'dashboard.issueNumber', dashboard.issueNumber, { min: 1, integer: true })

  if (dashboard.title !== undefined && (typeof dashboard.title !== 'string' || !dashboard.title.trim()))
    issues.push({ path: 'dashboard.title', message: `expected a non-empty string, got ${quote(dashboard.title)}` })
}

/**
 * Render validation issues as a single multi-line, human-readable block.
 *
 * @param issues - Issues from {@link validateConfig}
 * @returns Formatted message, one issue per line
 */
export function formatConfigIssues(issues: readonly ConfigIssue[]): string {
  return issues.map(issue => `  • ${issue.path}: ${issue.message}`).join('\n')
}

/**
 * Validate a configuration and throw when anything is wrong.
 *
 * @param config - Configuration to check
 * @throws {ConfigurationError} Listing every issue found
 */
export function assertValidConfig(config: BuddyBotConfig): void {
  const issues = validateConfig(config)
  if (issues.length === 0)
    return

  throw new ConfigurationError(
    `Invalid buddy-bot configuration (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${formatConfigIssues(issues)}`,
    issues[0].path,
  )
}
