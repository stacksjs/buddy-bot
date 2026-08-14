import type { FileChange, Issue, IssueOptions, PullRequest, PullRequestOptions } from '../types'
import type { Logger } from '../utils/logger'
import process from 'node:process'

/**
 * Hosting platforms buddy-bot knows about.
 *
 * A name appearing here does not mean it works — {@link IMPLEMENTED_PROVIDERS}
 * is the list that does. Naming the unimplemented ones lets configuration
 * validation reject them with the issue that tracks the work rather than a
 * generic "unknown value", which is the difference between a user filing a
 * duplicate and finding the thread.
 */
export type GitProviderName = 'github' | 'gitlab' | 'bitbucket'

/** Every provider name the type admits, in preference order. */
export const PROVIDER_NAMES: GitProviderName[] = ['github', 'gitlab', 'bitbucket']

/** Providers with a working implementation today. */
export const IMPLEMENTED_PROVIDERS: GitProviderName[] = ['github']

/** Where to follow the work for a provider that is named but not built. */
export const PROVIDER_TRACKING_ISSUES: Record<string, string> = {
  gitlab: 'https://github.com/stacksjs/buddy-bot/issues/115',
  bitbucket: 'https://github.com/stacksjs/buddy-bot/issues/116',
}

/**
 * What a provider can actually do.
 *
 * Buddy-bot's feature surface is wider than any single platform's API, so
 * features degrade against these flags instead of assuming GitHub. A caller
 * that checks a flag before calling the matching optional method gets a
 * documented no-op on platforms that lack it; a caller that does not gets a
 * `TypeError`, which is the intended pressure to check.
 */
export interface ProviderCapabilities {
  /** Pin an issue to the top of the issue list (`pinIssue`/`unpinIssue`) */
  pinIssues: boolean
  /** Publish a check run against a commit (`createCheckRun`) */
  checkRuns: boolean
  /** Post a review with line-anchored inline comments (`createReview`) */
  inlineReviewComments: boolean
  /** Render ```suggestion blocks that a reviewer can apply in one click */
  reviewSuggestions: boolean
  /** Hand a pull request to a platform-side merge queue (`enableAutoMerge`) */
  nativeAutoMerge: boolean
  /** React to a comment with an emoji (`reactToComment`) */
  commentReactions: boolean
  /** Read CI logs for a failed run (`getWorkflowRunLogs`) */
  ciLogs: boolean
  /** Request review from a team as well as individuals */
  teamReviewers: boolean
  /** Open a pull request in a draft/WIP state */
  draftPullRequests: boolean
  /** Look up whether a user can write to the repository (`hasWriteAccess`) */
  permissionLookup: boolean
  /** Enumerate and prune buddy-bot's own branches */
  branchHousekeeping: boolean
}

/** Capabilities all false, to spread over in a provider that supports few. */
export const NO_CAPABILITIES: ProviderCapabilities = {
  pinIssues: false,
  checkRuns: false,
  inlineReviewComments: false,
  reviewSuggestions: false,
  nativeAutoMerge: false,
  commentReactions: false,
  ciLogs: false,
  teamReviewers: false,
  draftPullRequests: false,
  permissionLookup: false,
  branchHousekeeping: false,
}

/** A branch buddy-bot created, as the provider reports it. */
export interface ProviderBranch {
  name: string
  sha: string
  lastCommitDate: Date
}

/** A review to publish on a pull request. */
export interface ReviewSubmission {
  body: string
  event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'
  /** Line-anchored comments; requires `inlineReviewComments` */
  comments?: Array<{ path: string, line: number, side: 'RIGHT' | 'LEFT', body: string }>
}

/** What publishing a review actually achieved. */
export interface ReviewSubmissionResult {
  posted: boolean
  inlineComments: number
}

/** Outcome of a check run. */
export interface CheckRunResult {
  conclusion: 'success' | 'failure' | 'neutral'
  title: string
  summary: string
}

/**
 * Everything buddy-bot needs from a hosting platform.
 *
 * The required members are the ones every code-hosting platform has; the
 * optional ones are gated by {@link ProviderCapabilities}. This split is the
 * contract a new provider implements: satisfy the required half and declare
 * honestly which of the optional half you support.
 *
 * @example
 * ```ts
 * const provider = createProvider({ provider: 'github', owner: 'o', name: 'r', token })
 * if (provider.capabilities().pinIssues)
 *   await provider.pinIssue?.(dashboard.number)
 * ```
 */
export interface GitProvider {
  /** What this provider supports; callers gate optional methods on it */
  capabilities: () => ProviderCapabilities

  // -- Branches ------------------------------------------------------------

  /** Whether a branch exists on the remote */
  branchExists: (branchName: string) => Promise<boolean>

  /** Create a branch from a base branch */
  createBranch: (branchName: string, baseBranch: string) => Promise<void>

  /** Delete a branch */
  deleteBranch: (branchName: string) => Promise<void>

  /**
   * Commit files to a branch.
   *
   * Renovate-style: the branch is reset to `baseBranch` and the files applied
   * fresh, so a re-run produces the same tree rather than stacking fixups.
   */
  commitChanges: (branchName: string, message: string, files: FileChange[], baseBranch?: string) => Promise<void>

  /** File content at a ref, or null when the path does not exist there */
  getFileContent: (path: string, ref: string) => Promise<string | null>

  // -- Pull requests -------------------------------------------------------

  createPullRequest: (options: PullRequestOptions) => Promise<PullRequest>
  getPullRequests: (state?: 'open' | 'closed' | 'all') => Promise<PullRequest[]>
  updatePullRequest: (prNumber: number, options: Partial<PullRequestOptions>) => Promise<PullRequest>
  closePullRequest: (prNumber: number) => Promise<void>
  reopenPullRequest: (prNumber: number) => Promise<void>
  mergePullRequest: (prNumber: number, strategy?: 'merge' | 'squash' | 'rebase') => Promise<void>

  /** Unified diff of a pull request */
  getPullRequestDiff: (prNumber: number) => Promise<string>

  /** Head commit SHA of a pull request */
  getPullRequestHeadSha: (prNumber: number) => Promise<string>

  /** Post a comment on a pull request */
  createComment: (prNumber: number, comment: string) => Promise<void>

  // -- Issues --------------------------------------------------------------

  createIssue: (options: IssueOptions) => Promise<Issue>
  getIssues: (state?: 'open' | 'closed' | 'all') => Promise<Issue[]>
  updateIssue: (issueNumber: number, options: Partial<IssueOptions>) => Promise<Issue>
  closeIssue: (issueNumber: number) => Promise<void>

  /**
   * Remove an issue from the pinned list.
   *
   * Required rather than capability-gated because unpinning must be safe to
   * call unconditionally during cleanup; a provider without pinning returns
   * `false`. Pinning is the capability-gated direction.
   */
  unpinIssue: (issueNumber: number) => Promise<boolean>

  // -- Capability-gated ----------------------------------------------------

  /** Requires `pinIssues` */
  pinIssue?: (issueNumber: number) => Promise<boolean>

  /** Requires `nativeAutoMerge`; resolves false when the platform refused */
  enableAutoMerge?: (prNumber: number, strategy?: 'merge' | 'squash' | 'rebase') => Promise<boolean>

  /** Aggregate CI state of a pull request's head commit */
  getPullRequestChecksState?: (prNumber: number) => Promise<'success' | 'failure' | 'pending' | 'none'>

  /** Requires `inlineReviewComments` for the `comments` field */
  createReview?: (prNumber: number, review: ReviewSubmission) => Promise<ReviewSubmissionResult>

  /** Requires `checkRuns` */
  createCheckRun?: (name: string, headSha: string, result: CheckRunResult) => Promise<void>

  /** Requires `commentReactions` */
  reactToComment?: (commentId: number, reaction: 'eyes' | '+1' | '-1' | 'rocket' | 'confused') => Promise<void>

  /** Requires `permissionLookup` */
  hasWriteAccess?: (username: string) => Promise<boolean>

  /** Requires `ciLogs`; null when logs are unavailable or expired */
  getWorkflowRunLogs?: (runId: number) => Promise<string | null>

  // -- Housekeeping (requires `branchHousekeeping`) -------------------------

  /** Branches buddy-bot created */
  getBuddyBotBranches?: () => Promise<ProviderBranch[]>

  /** Buddy-bot branches with no open pull request */
  getOrphanedBuddyBotBranches?: () => Promise<ProviderBranch[]>

  /** Delete orphaned buddy-bot branches older than a cutoff */
  cleanupStaleBranches?: (olderThanDays?: number, dryRun?: boolean) => Promise<{ deleted: string[], failed: string[] }>
}

/** Raised when configuration names a provider buddy-bot cannot use. */
export class UnsupportedProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly trackingIssue?: string,
  ) {
    super(message)
    this.name = 'UnsupportedProviderError'
  }
}

/**
 * Environment variables consulted for each provider's token, in order.
 *
 * The ambient CI token comes first on purpose. It is not a fallback for the
 * buddy-bot token — the two have different jobs: the ambient token attributes
 * pull requests to the CI bot rather than to a human's personal token, while
 * `BUDDY_BOT_TOKEN` is passed separately as the *workflow* token for the
 * elevated scopes CI files need. Preferring the personal token here would
 * change who appears to have opened every pull request.
 */
export const PROVIDER_TOKEN_ENV: Record<GitProviderName, string[]> = {
  github: ['GITHUB_TOKEN', 'BUDDY_BOT_TOKEN'],
  gitlab: ['CI_JOB_TOKEN', 'GITLAB_TOKEN', 'BUDDY_BOT_TOKEN'],
  bitbucket: ['BITBUCKET_TOKEN', 'BUDDY_BOT_TOKEN'],
}

/**
 * Resolve a provider's token from the environment.
 *
 * @param provider - Provider name
 * @param env - Environment to read (defaults to `process.env`)
 * @returns The first token found, with the variable it came from
 */
export function resolveProviderToken(
  provider: GitProviderName,
  env: Record<string, string | undefined> = process.env,
): { token: string, source: string } | null {
  for (const name of PROVIDER_TOKEN_ENV[provider] ?? []) {
    const value = env[name]?.trim()
    if (value)
      return { token: value, source: name }
  }

  return null
}

/**
 * Assert a provider name is one buddy-bot can actually use.
 *
 * @param provider - Name from configuration
 * @throws {UnsupportedProviderError} When unknown, or known but not built
 */
export function assertProviderSupported(provider: string): asserts provider is GitProviderName {
  if (IMPLEMENTED_PROVIDERS.includes(provider as GitProviderName))
    return

  const tracking = PROVIDER_TRACKING_ISSUES[provider]
  if (tracking) {
    throw new UnsupportedProviderError(
      `'${provider}' support is not implemented yet — follow ${tracking}. `
      + `Supported today: ${IMPLEMENTED_PROVIDERS.join(', ')}.`,
      provider,
      tracking,
    )
  }

  throw new UnsupportedProviderError(
    `Unknown git provider '${provider}'. Supported: ${IMPLEMENTED_PROVIDERS.join(', ')}.`,
    provider,
  )
}

/** Repository coordinates a provider is built against. */
export interface ProviderConfig {
  provider?: string
  owner: string
  name: string
  token?: string
  /** Token with permission to write CI workflow files, when distinct */
  workflowToken?: string
  /** API base URL override, for self-hosted instances */
  apiUrl?: string
}

/**
 * Build the provider for a repository configuration.
 *
 * @param config - Repository configuration
 * @param options - Logger and environment overrides
 * @returns A provider bound to the repository
 * @throws {UnsupportedProviderError} When the provider is unknown or unbuilt
 * @throws {Error} When no token can be resolved
 * @example
 * ```ts
 * const provider = await createProvider(config.repository, { logger })
 * const prs = await provider.getPullRequests('open')
 * ```
 */
export async function createProvider(
  config: ProviderConfig,
  options: { logger?: Logger, env?: Record<string, string | undefined> } = {},
): Promise<GitProvider> {
  const name = config.provider ?? 'github'
  assertProviderSupported(name)

  const env = options.env ?? process.env
  const token = config.token ?? resolveProviderToken(name, env)?.token
  if (!token) {
    throw new Error(
      `No token for ${name}. Set one of: ${PROVIDER_TOKEN_ENV[name].join(', ')}.`,
    )
  }

  // Imported lazily so a provider's transport dependencies are only loaded
  // when that provider is the one in use.
  const { GitHubProvider } = await import('./github-provider')

  const workflowToken = config.workflowToken ?? env.BUDDY_BOT_TOKEN
  return new GitHubProvider(
    token,
    config.owner,
    config.name,
    Boolean(workflowToken),
    workflowToken,
    config.apiUrl,
    options.logger,
  )
}

/**
 * Whether a provider supports a capability *and* exposes its method.
 *
 * Checks both because a flag without the method is a provider bug, and acting
 * on the flag alone would turn that bug into a `TypeError` at the call site.
 *
 * @param provider - The provider to interrogate
 * @param capability - Capability flag to check
 * @param method - Method the capability gates
 */
export function supports<K extends keyof GitProvider>(
  provider: GitProvider,
  capability: keyof ProviderCapabilities,
  method: K,
): provider is GitProvider & Required<Pick<GitProvider, K>> {
  return provider.capabilities()[capability] === true && typeof provider[method] === 'function'
}

/**
 * Assert a provider supports a capability, or explain what is missing.
 *
 * Used where the capability *is* the command — `buddy-bot cleanup` on a
 * provider that cannot enumerate branches has nothing to degrade to, so
 * failing with a clear reason beats a `TypeError` or a silent success.
 *
 * @param provider - The provider to interrogate
 * @param capability - Capability flag to require
 * @param method - Method the capability gates
 * @param purpose - What the caller was trying to do
 * @throws {UnsupportedProviderError} When the capability is absent
 */
export function assertSupports<K extends keyof GitProvider>(
  provider: GitProvider,
  capability: keyof ProviderCapabilities,
  method: K,
  purpose: string,
): asserts provider is GitProvider & Required<Pick<GitProvider, K>> {
  if (supports(provider, capability, method))
    return

  throw new UnsupportedProviderError(
    `This provider does not support ${purpose} (missing capability '${capability}').`,
    'unknown',
  )
}
