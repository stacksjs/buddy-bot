// Core configuration types
export interface BuddyBotConfig {
  /** Enable verbose logging */
  verbose?: boolean

  /** Repository settings */
  repository?: {
    /** Git provider (github, gitlab, etc.) */
    provider: 'github' | 'gitlab' | 'bitbucket'
    /** Repository owner/organization */
    owner: string
    /** Repository name */
    name: string
    /** Base branch for PRs */
    baseBranch?: string
    /** Access token for API operations */
    token?: string
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
  }

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
      conditions?: string[]
    }
    /** Reviewers to assign */
    reviewers?: string[]
    /** Assignees to assign */
    assignees?: string[]
    /** Labels to add */
    labels?: string[]
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
  type: 'package.json' | 'bun.lockb' | 'package-lock.json' | 'yarn.lock' | 'pnpm-lock.yaml' | 'deps.yaml' | 'deps.yml' | 'dependencies.yaml' | 'dependencies.yml' | 'pkgx.yaml' | 'pkgx.yml' | '.deps.yaml' | '.deps.yml' | 'composer.json' | 'composer.lock' | 'github-actions'
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
  type: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies' | 'require' | 'require-dev' | 'github-actions'
  /** File where dependency is defined */
  file: string
  /** Line number in file */
  line?: number
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
  dependencyType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies' | 'require' | 'require-dev' | 'github-actions'
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
  /** Create a new branch */
  createBranch: (branchName: string, baseBranch: string) => Promise<void>

  /** Commit changes to branch */
  commitChanges: (branchName: string, message: string, files: FileChange[]) => Promise<void>

  /** Create pull request */
  createPullRequest: (options: PullRequestOptions) => Promise<PullRequest>

  /** Get existing pull requests */
  getPullRequests: (state?: 'open' | 'closed' | 'all') => Promise<PullRequest[]>

  /** Update pull request */
  updatePullRequest: (prNumber: number, options: Partial<PullRequestOptions>) => Promise<PullRequest>

  /** Close pull request */
  closePullRequest: (prNumber: number) => Promise<void>

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
  /** Repository information */
  repository: {
    owner: string
    name: string
    provider: string
  }
  /** Last update timestamp */
  lastUpdated: Date
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
