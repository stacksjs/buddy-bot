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

export {
  detectRequiredPackageManagers,
  getAllLockFilePaths,
  regenerateLockFile,
} from './utils/lock-file'
export type { LockFileResult, PackageManagerType } from './utils/lock-file'

export { getDefaultLogger, Logger, setDefaultLogger } from './utils/logger'
export type { LogLevel } from './utils/logger'

export { VersionResolver } from './version/version-resolver'
