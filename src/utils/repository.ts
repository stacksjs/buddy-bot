import type { BuddyBotConfig } from '../types'
import process from 'node:process'

export interface RepositoryResolution {
  /** The owner/name buddy-bot will operate on, if it could be determined. */
  owner?: string
  name?: string
  /** Where the value came from. */
  source: 'config' | 'environment' | 'unresolved'
  /** True when GITHUB_REPOSITORY replaced a conflicting configured value. */
  overrodeConfig: boolean
  /** Human-readable explanation, present only when an override happened. */
  warning?: string
}

function parseGitHubRepository(value: string | undefined): { owner: string, name: string } | null {
  if (!value)
    return null

  const [owner, name] = value.split('/')
  if (!owner || !name)
    return null

  return { owner, name }
}

/**
 * Resolve the repository buddy-bot should operate on, mutating the config in place.
 *
 * `GITHUB_REPOSITORY` wins over a configured owner/name whenever the two disagree.
 * buddy-bot commits and pushes through the local checkout's `origin`, so the API
 * target must be the repository that is actually checked out — a config pointing
 * elsewhere (commonly a value copy-pasted from another project's config) can only
 * produce 403s and updates aimed at the wrong repo.
 *
 * A configured `dashboard.issueNumber` is dropped when the repository is overridden,
 * since an issue number is only meaningful within the repository it came from.
 *
 * @param config - Configuration to resolve and mutate
 * @param env - Environment to read `GITHUB_REPOSITORY` from (defaults to `process.env`)
 * @returns Details of what was resolved and whether the config was overridden
 * @example
 * ```ts
 * const result = resolveRepositoryConfig(config)
 * if (result.warning)
 *   logger.warn(result.warning)
 * ```
 */
export function resolveRepositoryConfig(
  config: BuddyBotConfig,
  env: Record<string, string | undefined> = process.env,
): RepositoryResolution {
  if (!config.repository)
    return { source: 'unresolved', overrodeConfig: false }

  const configured = config.repository
  const detected = parseGitHubRepository(env.GITHUB_REPOSITORY)
  const hasConfigured = Boolean(configured.owner && configured.name)

  if (!detected) {
    return hasConfigured
      ? { owner: configured.owner, name: configured.name, source: 'config', overrodeConfig: false }
      : { source: 'unresolved', overrodeConfig: false }
  }

  const isMismatch = hasConfigured
    && (configured.owner !== detected.owner || configured.name !== detected.name)

  if (isMismatch) {
    const stale = `${configured.owner}/${configured.name}`
    const warning
      = `Configured repository ${stale} does not match GITHUB_REPOSITORY `
        + `${detected.owner}/${detected.name}. Using ${detected.owner}/${detected.name} — buddy-bot `
        + `operates on the checked-out repository. Update repository.owner/repository.name in your `
        + `buddy-bot config to silence this warning.`

    configured.owner = detected.owner
    configured.name = detected.name

    // An issue number from the stale repository does not exist here; drop it so the
    // dashboard is looked up (and created if absent) in the correct repository.
    if (config.dashboard?.issueNumber !== undefined)
      config.dashboard.issueNumber = undefined

    return { owner: detected.owner, name: detected.name, source: 'environment', overrodeConfig: true, warning }
  }

  if (!hasConfigured) {
    configured.owner ||= detected.owner
    configured.name ||= detected.name
    return { owner: detected.owner, name: detected.name, source: 'environment', overrodeConfig: false }
  }

  return { owner: configured.owner, name: configured.name, source: 'config', overrodeConfig: false }
}
