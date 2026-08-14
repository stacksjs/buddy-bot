import type { LogLevel } from './utils/logger'

/**
 * Git hosting providers with a working {@link GitProvider} implementation.
 *
 * Kept as a single-member union on purpose: widening it is the signal that a
 * real implementation has landed, so a config typo cannot compile into a
 * runtime failure halfway through a workflow run.
 */
export type GitProviderName = 'github'

/** Advisory severity, ordered from least to most severe. */
export type VulnerabilitySeverity = 'low' | 'moderate' | 'high' | 'critical'

// Core configuration types
export interface BuddyBotConfig {
  /** Enable verbose logging. Equivalent to `logLevel: 'debug'`. */
  verbose?: boolean

  /**
   * How much output to emit. Overrides {@link verbose} when both are set.
   *
   * Use `'silent'` when embedding buddy-bot in another tool that owns its own
   * output. Can also be set with `BUDDY_BOT_LOG_LEVEL`.
   */
  logLevel?: LogLevel

  /** Repository settings */
  repository?: {
    /**
     * Git provider. Only `github` is implemented — GitLab and Bitbucket
     * support would need a full `GitProvider` implementation, so they are
     * deliberately absent from this union rather than failing at runtime.
     */
    provider: GitProviderName
    /** Repository owner/organization */
    owner: string
    /** Repository name */
    name: string
    /** Base branch for PRs */
    baseBranch?: string
    /** Access token for API operations */
    token?: string
    /**
     * REST API base URL. Defaults to `GITHUB_API_URL` when set (GitHub Actions
     * exports it on both github.com and Enterprise Server runners), otherwise
     * `https://api.github.com`. Set explicitly for GitHub Enterprise Server,
     * e.g. `https://github.acme.com/api/v3`.
     */
    apiUrl?: string
    /**
     * Web base URL used for links in PR bodies and the dashboard. Defaults to
     * `GITHUB_SERVER_URL`, otherwise `https://github.com`.
     */
    serverUrl?: string
  }

  /** Package registry endpoints, for private or self-hosted mirrors */
  registries?: {
    /** npm registry base URL (default: `.npmrc` `registry=`, else registry.npmjs.org) */
    npm?: string
    /** Per-scope npm registry overrides, keyed by scope including the `@` */
    npmScopes?: Record<string, string>
    /** Composer/Packagist base URL (default: packagist.org) */
    composer?: string
  }

  /** Security advisory settings */
  security?: {
    /**
     * Query the OSV.dev advisory database and flag dependencies with known
     * vulnerabilities (default: true). Disable for fully offline runs.
     */
    enabled?: boolean
    /**
     * Move updates that resolve a known advisory to the front of the queue so
     * they survive the `maxPRsPerRun` cap (default: true).
     */
    prioritize?: boolean
    /** Label applied to PRs that resolve an advisory (default: `security`) */
    label?: string
    /** Minimum severity to act on (default: `low`, i.e. everything) */
    minimumSeverity?: VulnerabilitySeverity
  }

  /** Update scheduling and strategies */
  schedule?: {
    /** Cron expression for scheduled runs */
    cron?: string
    /** Time zone for scheduling */
    timezone?: string
  }

  /** Package update configuration */
  packages?: {
    /** Update strategy for dependencies */
    strategy: 'major' | 'minor' | 'patch' | 'all'
    /** Packages to ignore */
    ignore?: string[]
    /** File/directory paths to ignore using glob patterns */
    ignorePaths?: string[]
    /** Packages to pin to specific versions */
    pin?: Record<string, string>
    /** Group related packages together */
    groups?: PackageGroup[]
    /** Include prerelease versions (alpha, beta, rc, etc.) */
    includePrerelease?: boolean
    /** Exclude major version updates (even if strategy allows them) */
    excludeMajor?: boolean
    /** Respect "latest" and "*" version indicators (default: true) */
    respectLatest?: boolean
    /** Minimum age in minutes that a package version must have before installation (default: 0) */
    minimumReleaseAge?: number
    /** Package names to exclude from minimum release age requirement */
    minimumReleaseAgeExclude?: string[]
  }

  /** Maximum number of PRs to create per workflow run (default: 10) */
  maxPRsPerRun?: number

  /** PR generation settings */
  pullRequest?: {
    /** Commit message format */
    commitMessageFormat?: string
    /** PR title format */
    titleFormat?: string
    /** PR body template */
    bodyTemplate?: string
    /** Auto-merge settings */
    autoMerge?: {
      enabled: boolean
      strategy: 'merge' | 'squash' | 'rebase'
      /**
       * Which updates may merge without review: `patch-only`, `minor-only`,
       * `security-only` or `all`. A PR qualifies when any listed condition
       * accepts it.
       *
       * An empty or missing list means nothing auto-merges — the safe reading
       * of a half-written config.
       */
      conditions?: string[]
      /**
       * Require passing checks before merging (default: true).
       *
       * Only meaningful on repositories without branch protection, where
       * buddy-bot merges directly instead of handing the PR to GitHub's own
       * auto-merge queue.
       */
      requireGreenCI?: boolean
      /** Label that suppresses auto-merge on a PR (default: `no-auto-merge`) */
      optOutLabel?: string
    }
    /** Reviewers to assign */
    reviewers?: string[]
    /** Assignees to assign */
    assignees?: string[]
    /** Labels to add */
    labels?: string[]
  }

  /** Release notes configuration */
  releaseNotes?: {
    /** Enable release notes in PRs (default: true) */
    enabled?: boolean
    /** Sanitize GitHub references (#123, issue/PR URLs) to prevent spam notifications (default: true) */
    sanitizeReferences?: boolean
    /** Maximum number of releases to show per package (default: 3) */
    maxReleases?: number
    /** Maximum character length per release body (default: 1000) */
    maxBodyLength?: number
    /** Include compare links between versions (default: true) */
    includeCompareLinks?: boolean
  }

  /** Workflow generation settings */
  workflows?: {
    /** Enable workflow generation */
    enabled?: boolean
    /** Output directory for workflows */
    outputDir?: string
    /** Workflow templates to generate */
    templates?: {
      /** Generate comprehensive multi-strategy workflow */
      comprehensive?: boolean
      /** Generate daily patch updates workflow */
      daily?: boolean
      /** Generate weekly minor updates workflow */
      weekly?: boolean
      /** Generate monthly major updates workflow */
      monthly?: boolean
      /** Generate Docker-based workflow */
      docker?: boolean
      /** Generate monorepo workflow */
      monorepo?: boolean
    }
    /** Custom workflow configurations */
    custom?: {
      /** Workflow name */
      name: string
      /** Cron schedule */
      schedule: string
      /** Update strategy */
      strategy?: 'major' | 'minor' | 'patch' | 'all'
      /** Auto-merge enabled */
      autoMerge?: boolean
      /** Reviewers */
      reviewers?: string[]
      /** Assignees */
      assignees?: string[]
      /** Labels */
      labels?: string[]
    }[]
  }

  /** Dependency Dashboard settings */
  dashboard?: {
    /** Enable dependency dashboard */
    enabled?: boolean
    /** Dashboard title */
    title?: string
    /** Dashboard body template */
    bodyTemplate?: string
    /** Labels to add to dashboard issue */
    labels?: string[]
    /** Assignees to assign to dashboard issue */
    assignees?: string[]
    /** Include package.json dependencies */
    includePackageJson?: boolean
    /** Include dependency files (deps.yaml, etc.) */
    includeDependencyFiles?: boolean
    /** Include GitHub Actions */
    includeGitHubActions?: boolean
    /** Show open PRs section */
    showOpenPRs?: boolean
    /** Show detected dependencies section */
    showDetectedDependencies?: boolean
    /** Show deprecated dependencies section */
    showDeprecatedDependencies?: boolean
    /** Issue number to update (if it exists) */
    issueNumber?: number
  }
}

export type BuddyBotOptions = Partial<BuddyBotConfig>

export interface PackageGroup {
  /** Group name */
  name: string
  /** Package patterns to include */
  patterns: string[]
  /** Update strategy for this group */
  strategy?: 'major' | 'minor' | 'patch' | 'all'
}

// Package management types
export interface PackageFile {
  /** File path relative to repository root */
  path: string
  /** Type of package file */
  type: 'package.json' | 'bun.lock' | 'bun.lockb' | 'package-lock.json' | 'yarn.lock' | 'pnpm-lock.yaml' | 'deps.yaml' | 'deps.yml' | 'dependencies.yaml' | 'dependencies.yml' | 'pkgx.yaml' | 'pkgx.yml' | '.deps.yaml' | '.deps.yml' | 'composer.json' | 'composer.lock' | 'github-actions' | 'Dockerfile' | 'build.zig.zon' | 'pantry.lock'
  /** Raw file content */
  content: string
  /** Parsed dependencies */
  dependencies: Dependency[]
}

export interface Dependency {
  /** Package name */
  name: string
  /** Current version or range */
  currentVersion: string
  /** Dependency type */
  type: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies' | 'require' | 'require-dev' | 'github-actions' | 'docker-image' | 'zig-dependencies'
  /** File where dependency is defined */
  file: string
  /** Line number in file */
  line?: number
  /** Additional metadata (e.g., URL, hash for Zig dependencies) */
  metadata?: Record<string, string>
}

export interface PackageUpdate {
  /** Package name */
  name: string
  /** Current version */
  currentVersion: string
  /** New version available */
  newVersion: string
  /** Update type */
  updateType: 'major' | 'minor' | 'patch'
  /** Dependency type */
  dependencyType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies' | 'require' | 'require-dev' | 'github-actions' | 'docker-image' | 'zig-dependencies'
  /** Source file */
  file: string
  /** Package metadata from registry */
  metadata?: PackageMetadata
  /** Release notes URL */
  releaseNotesUrl?: string
  /** Changelog URL */
  changelogUrl?: string
  /** Homepage URL */
  homepage?: string
  /**
   * Known advisories affecting {@link currentVersion} that {@link newVersion}
   * resolves. Populated by the advisory service when `security.enabled`.
   */
  securityAdvisories?: SecurityAdvisory[]
}

/**
 * A known vulnerability affecting a specific dependency version, as reported
 * by the OSV.dev aggregated advisory database.
 */
export interface SecurityAdvisory {
  /** Primary advisory identifier, e.g. `GHSA-xxxx-yyyy-zzzz` */
  id: string
  /** Related identifiers such as CVE numbers */
  aliases: string[]
  /** One-line summary of the vulnerability */
  summary: string
  /** Normalized severity */
  severity: VulnerabilitySeverity
  /** Advisory detail page */
  url?: string
  /** First version that is not affected, when the advisory states one */
  fixedVersion?: string
}

export interface PackageMetadata {
  /** Package name */
  name: string
  /** Package description */
  description?: string
  /** Repository URL */
  repository?: string
  /** Homepage URL */
  homepage?: string
  /** License */
  license?: string
  /** Author information */
  author?: string | { name: string, email?: string }
  /** Keywords */
  keywords?: string[]
  /** Latest version */
  latestVersion: string
  /** All available versions */
  versions: string[]
  /** Weekly download count */
  weeklyDownloads?: number
  /** Dependencies */
  dependencies?: Record<string, string>
  /** Dev dependencies */
  devDependencies?: Record<string, string>
  /** Peer dependencies */
  peerDependencies?: Record<string, string>
}

// Git and PR types
export interface GitProvider {
  /** Check if a branch exists */
  branchExists: (branchName: string) => Promise<boolean>

  /** Create a new branch */
  createBranch: (branchName: string, baseBranch: string) => Promise<void>

  /** Commit changes to branch (Renovate-style: resets branch to baseBranch, applies files fresh) */
  commitChanges: (branchName: string, message: string, files: FileChange[], baseBranch?: string) => Promise<void>

  /** Create pull request */
  createPullRequest: (options: PullRequestOptions) => Promise<PullRequest>

  /** Get existing pull requests */
  getPullRequests: (state?: 'open' | 'closed' | 'all') => Promise<PullRequest[]>

  /** Update pull request */
  updatePullRequest: (prNumber: number, options: Partial<PullRequestOptions>) => Promise<PullRequest>

  /** Close pull request */
  closePullRequest: (prNumber: number) => Promise<void>

  /** Reopen a closed pull request */
  reopenPullRequest: (prNumber: number) => Promise<void>

  /** Create comment on pull request */
  createComment: (prNumber: number, comment: string) => Promise<void>

  /** Merge pull request */
  mergePullRequest: (prNumber: number, strategy?: 'merge' | 'squash' | 'rebase') => Promise<void>

  /** Delete a branch */
  deleteBranch: (branchName: string) => Promise<void>

  /** Create GitHub issue */
  createIssue: (options: IssueOptions) => Promise<Issue>

  /** Get existing issues */
  getIssues: (state?: 'open' | 'closed' | 'all') => Promise<Issue[]>

  /** Update issue */
  updateIssue: (issueNumber: number, options: Partial<IssueOptions>) => Promise<Issue>

  /** Close issue */
  closeIssue: (issueNumber: number) => Promise<void>

  /** Unpin issue - Note: GitHub REST API does not support pinning issues programmatically */
  unpinIssue: (issueNumber: number) => Promise<void>
}

export interface FileChange {
  /** File path */
  path: string
  /** File content */
  content: string
  /** Change type */
  type: 'create' | 'update' | 'delete'
}

export interface PullRequestOptions {
  /** PR title */
  title: string
  /** PR body/description */
  body: string
  /** Head branch (source) */
  head: string
  /** Base branch (target) */
  base: string
  /** Draft status */
  draft?: boolean
  /** Reviewers to assign */
  reviewers?: string[]
  /** Team reviewers to assign */
  teamReviewers?: string[]
  /** Assignees to assign */
  assignees?: string[]
  /** Labels to add */
  labels?: string[]
  /** Milestone to assign */
  milestone?: number
}

export interface PullRequest {
  /** PR number */
  number: number
  /** PR title */
  title: string
  /** PR body/description */
  body: string
  /** Head branch */
  head: string
  /** Base branch */
  base: string
  /** PR state */
  state: 'open' | 'closed' | 'merged'
  /** PR URL */
  url: string
  /** Creation date */
  createdAt: Date
  /** Last update date */
  updatedAt: Date
  /** Merge date (if merged) */
  mergedAt?: Date
  /** Author */
  author: string
  /** Reviewers */
  reviewers: string[]
  /** Assignees */
  assignees: string[]
  /** Labels */
  labels: string[]
  /** Is draft */
  draft: boolean
}

export interface IssueOptions {
  /** Issue title */
  title: string
  /** Issue body/description */
  body: string
  /** Assignees to assign */
  assignees?: string[]
  /** Labels to add */
  labels?: string[]
  /** Milestone to assign */
  milestone?: number
}

export interface Issue {
  /** Issue number */
  number: number
  /** Issue title */
  title: string
  /** Issue body/description */
  body: string
  /** Issue state */
  state: 'open' | 'closed'
  /** Issue URL */
  url: string
  /** Creation date */
  createdAt: Date
  /** Last update date */
  updatedAt: Date
  /** Close date (if closed) */
  closedAt?: Date
  /** Author */
  author: string
  /** Assignees */
  assignees: string[]
  /** Labels */
  labels: string[]
  /** Is pinned */
  pinned?: boolean
}

// Update scanning and processing types
export interface UpdateScanResult {
  /** Total packages scanned */
  totalPackages: number
  /** Available updates */
  updates: PackageUpdate[]
  /** Grouped updates */
  groups: UpdateGroup[]
  /** Scan timestamp */
  scannedAt: Date
  /** Scan duration in milliseconds */
  duration: number
}

export interface UpdateGroup {
  /** Group name */
  name: string
  /** Updates in this group */
  updates: PackageUpdate[]
  /** Group update type (highest severity) */
  updateType: 'major' | 'minor' | 'patch'
  /** PR title for this group */
  title: string
  /** PR body for this group */
  body: string
}

/**
 * A single dependency change recorded in a pull request's metadata manifest.
 *
 * Field names are deliberately short: the manifest is embedded in every PR
 * body and competes with release notes for GitHub's 65,536 character limit.
 */
export interface PRManifestUpdate {
  /** Package name */
  name: string
  /** Version or range before the update */
  current: string
  /** Version or range the PR moves to */
  target: string
  /** Semver impact of the change. Omitted from size-reduced manifests. */
  type?: 'major' | 'minor' | 'patch'
  /** Manifest file the change applies to */
  file: string
  /**
   * Where in the manifest the dependency is declared. Omitted from
   * size-reduced manifests.
   */
  dependencyType?: string
}

/**
 * Machine-readable description of what a buddy-bot pull request changes,
 * embedded in the PR body as an HTML comment.
 *
 * Rebasing and auto-closing read this instead of re-parsing the rendered
 * markdown tables, so PR body formatting can change freely without breaking
 * PR lifecycle logic.
 */
export interface PRManifest {
  /** Manifest schema version, for forward compatibility */
  schemaVersion: number
  /** Dependency changes contained in the PR */
  updates: PRManifestUpdate[]
  /** Update group that produced the PR */
  group?: string
  /** Update strategy in effect when the PR was generated */
  strategy?: string
  /** Head branch the PR was opened from */
  branch?: string
  /** ISO timestamp of generation */
  generatedAt?: string
  /**
   * Set when the update list was shortened to keep the manifest within its
   * size ceiling. Consumers that need the complete set — rebase group
   * matching, for one — must treat a truncated manifest as unusable rather
   * than acting on a partial view.
   */
  truncated?: boolean
}

export interface DashboardData {
  /** Open pull requests */
  openPRs: PullRequest[]
  /** Detected package files and their dependencies */
  detectedDependencies: {
    /** Package.json files */
    packageJson: PackageFile[]
    /** Dependency files (deps.yaml, etc.) */
    dependencyFiles: PackageFile[]
    /** GitHub Actions files */
    githubActions: PackageFile[]
  }
  /** Deprecated dependencies found */
  deprecatedDependencies?: DeprecatedDependency[]
  /** Dependencies with known, unresolved security advisories */
  vulnerableDependencies?: VulnerableDependency[]
  /** Repository information */
  repository: {
    owner: string
    name: string
    provider: string
  }
  /** Last update timestamp */
  lastUpdated: Date
}

/** A dependency version with one or more known advisories against it. */
export interface VulnerableDependency {
  /** Package name */
  name: string
  /** Version currently declared in the repository */
  currentVersion: string
  /** Ecosystem the advisory database matched, e.g. `npm` */
  ecosystem: string
  /** File where the dependency is declared */
  file: string
  /** Advisories affecting {@link currentVersion} */
  advisories: SecurityAdvisory[]
}

export interface DeprecatedDependency {
  /** Package name */
  name: string
  /** Current version being used */
  currentVersion: string
  /** Datasource (npm, bun, composer, etc.) */
  datasource: string
  /** File where dependency is defined */
  file: string
  /** Dependency type */
  type: string
  /** Whether a replacement PR is available */
  replacementAvailable: boolean
  /** Suggested replacement package (if available) */
  suggestedReplacement?: string
  /** Deprecation message from registry */
  deprecationMessage?: string
}

// CLI and command types
export interface BuddyCommand {
  /** Command name */
  name: string
  /** Command description */
  description: string
  /** Command options */
  options?: CommandOption[]
  /** Command action */
  action: (args: any) => Promise<void>
}

export interface CommandOption {
  /** Option name */
  name: string
  /** Option description */
  description: string
  /** Option type */
  type: 'string' | 'boolean' | 'number'
  /** Default value */
  default?: any
  /** Is required */
  required?: boolean
  /** Option alias */
  alias?: string
}

// Utility types
export interface Logger {
  info: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
  success: (message: string, ...args: any[]) => void
}

export interface VersionRange {
  /** Raw version string */
  raw: string
  /** Parsed version range */
  range: string
  /** Is exact version */
  isExact: boolean
  /** Satisfies version */
  satisfies: (version: string) => boolean
  /** Get latest version that satisfies range */
  getLatest: (versions: string[]) => string | null
}

// Error types
export class BuddyError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: any,
  ) {
    super(message)
    this.name = 'BuddyError'
  }
}

export class PackageRegistryError extends BuddyError {
  constructor(message: string, public packageName?: string) {
    super(message, 'REGISTRY_ERROR')
    this.name = 'PackageRegistryError'
  }
}

export class GitProviderError extends BuddyError {
  constructor(message: string, public operation?: string) {
    super(message, 'GIT_PROVIDER_ERROR')
    this.name = 'GitProviderError'
  }
}

export class ConfigurationError extends BuddyError {
  constructor(message: string, public configKey?: string) {
    super(message, 'CONFIG_ERROR')
    this.name = 'ConfigurationError'
  }
}
