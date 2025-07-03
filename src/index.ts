export * from './types'

// Core functionality exports
export { PackageScanner } from './scanner/package-scanner'
export { RegistryClient } from './registry/registry-client'
export { VersionResolver } from './version/version-resolver'
export { GitHubProvider } from './git/github-provider'
export { GitLabProvider } from './git/gitlab-provider'
export { UpdateProcessor } from './update/update-processor'
export { PullRequestGenerator } from './pr/pr-generator'
export { ConfigManager } from './config/config-manager'
export { Logger } from './utils/logger'

// Main Buddy class
export { Buddy } from './buddy'

// CLI exports
export { createCLI } from './cli/cli'
export { runCommand } from './cli/commands'

// Utility functions
export {
  parsePackageFile,
  detectPackageManager,
  formatCommitMessage,
  formatPRTitle,
  formatPRBody,
  generateBranchName,
  groupUpdates,
  sortUpdatesByPriority
} from './utils/helpers'
