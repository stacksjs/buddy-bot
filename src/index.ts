// Main Buddy class
export { Buddy } from './buddy'

// CLI exports
export { createCLI } from './cli/cli'
export { GitHubProvider } from './git/github-provider'
export { GitLabProvider } from './git/gitlab-provider'
export { PullRequestGenerator } from './pr/pr-generator'
export { RegistryClient } from './registry/registry-client'
// Core functionality exports
export { PackageScanner } from './scanner/package-scanner'
export { Scheduler } from './scheduler/scheduler'
// Enhanced services
export { ReleaseNotesFetcher } from './services/release-notes-fetcher'

export { GitHubActionsTemplate } from './templates/github-actions'

export * from './types'
export { UpdateProcessor } from './update/update-processor'
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

export { Logger } from './utils/logger'

export { VersionResolver } from './version/version-resolver'
