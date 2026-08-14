// Main Buddy class
export { Buddy } from './buddy'

export { GitHubProvider } from './git/github-provider'
export { PullRequestGenerator } from './pr/pr-generator'
export { RegistryClient } from './registry/registry-client'
// Core functionality exports
export { PackageScanner } from './scanner/package-scanner'
export { Scheduler } from './scheduler/scheduler'
// Enhanced services
export { ReleaseNotesFetcher } from './services/release-notes-fetcher'
export {
  advisoryKey,
  normalizeSeverity,
  SecurityAdvisoryService,
  toOsvEcosystem,
} from './services/security-advisories'
export type { AdvisoryQuery } from './services/security-advisories'

export { GitHubActionsTemplate } from './templates/github-actions'

export * from './types'
// Utility functions
export {
  detectPackageManager,
  formatCommitMessage,
  formatPRBody,
  formatPRTitle,
  generateBranchName,
  groupUpdates,
  parsePackageFile,
  sortUpdatesByPriority,
} from './utils/helpers'

export {
  clearNpmrcCache,
  getComposerRegistryUrl,
  getGitHubApiUrl,
  getGitHubServerUrl,
  getNpmRegistryUrl,
} from './utils/endpoints'

export {
  assertValidConfig,
  formatConfigIssues,
  validateConfig,
} from './config-validation'
export type { ConfigIssue } from './config-validation'

export { AsyncMemo, chunk, DEFAULT_CONCURRENCY, mapWithConcurrency } from './utils/concurrency'

export { formatError, GitHubApiError } from './utils/errors'

export {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  fetchJsonOrNull,
  fetchWithTimeout,
  HttpRequestError,
  parseRetryDelay,
} from './utils/http'
export type { HttpRequestOptions } from './utils/http'

export { formatSecurityAdvisorySection } from './utils/security-format'

export {
  detectRequiredPackageManagers,
  getAllLockFilePaths,
  regenerateLockFile,
} from './utils/lock-file'
export type { LockFileResult, PackageManagerType } from './utils/lock-file'

export { getDefaultLogger, Logger, setDefaultLogger } from './utils/logger'
export type { LogLevel } from './utils/logger'

export { VersionResolver } from './version/version-resolver'

/**
 * Packages that are behind for a reason no manifest shows: a transitive
 * dependant's range capping what the installer can resolve to.
 */
export {
  type DeclaredRange,
  describeDrift,
  type Drift,
  driftFor,
  type DriftInput,
  type DriftKind,
  findDrift,
  ROOT,
} from './scanner/resolution-drift'

// AI provider layer
export * from './ai'
