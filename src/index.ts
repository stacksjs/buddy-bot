// Main Buddy class
export { Buddy } from './buddy'

export { GitHubProvider } from './git/github-provider'
export {
  assertProviderSupported,
  assertSupports,
  createProvider,
  IMPLEMENTED_PROVIDERS,
  NO_CAPABILITIES,
  PROVIDER_NAMES,
  PROVIDER_TOKEN_ENV,
  PROVIDER_TRACKING_ISSUES,
  resolveProviderToken,
  supports,
  UnsupportedProviderError,
} from './git/provider'
export type {
  CheckRunResult,
  GitProvider,
  GitProviderName,
  ProviderBranch,
  ProviderCapabilities,
  ProviderConfig,
  ReviewSubmission,
  ReviewSubmissionResult,
} from './git/provider'
export { diagnose, renderDoctorReport } from './doctor'
export type { DoctorCheck, DoctorEnvironment, DoctorReport } from './doctor'
export { formatGithubOutput, publishOutput, runHeadless, validateAgainstSchema } from './headless/run'
export type { HeadlessOptions, HeadlessResult, SchemaViolation } from './headless/run'
export {
  adapterFor,
  adapterNamed,
  BUILTIN_ADAPTERS,
  comparePep440,
  compareNumeric,
  detectFiles,
  goAdapter,
  isPep440Prerelease,
  numericUpdateType,
  parsePep440,
  pep440UpdateType,
  pythonAdapter,
  regenerateLockfiles,
  rubyAdapter,
  rustAdapter,
  scanEcosystems,
  splitConstraint,
  stripOperators,
} from './ecosystems'
export type {
  AdapterScanOptions,
  AdapterScanResult,
  EcosystemAdapter,
  EcosystemDependency,
  EcosystemUpdate,
  LatestOptions,
  Pep440Version,
  VersionInfo,
} from './ecosystems'
export { PullRequestGenerator } from './pr/pr-generator'
export {
  compareVersions,
  parseTag,
  sameVariant,
  selectLatestTag,
  tagUpdateType,
} from './registry/docker-tags'
export type { ParsedTag } from './registry/docker-tags'
export {
  apiHostFor,
  formatImageRef,
  OciClient,
  parseAuthChallenge,
  parseImageRef,
  resolveCredentials,
} from './registry/oci-client'
export type { DockerRegistryConfig, ImageRef, RegistryAuth } from './registry/oci-client'
export {
  checkEol,
  cycleFor,
  describeEol,
  EOL_PRODUCTS,
  EOL_WARNING_DAYS,
  productFor,
} from './registry/eol'
export type { EolCycle, EolStatus } from './registry/eol'
export { RegistryClient } from './registry/registry-client'
export { applyCatalogUpdates, scanCatalogs } from './scanner/catalog-scan'
export type { CatalogScanResult } from './scanner/catalog-scan'
export {
  bumpEngineConstraint,
  collectResolutionPins,
  extractEngines,
  KNOWN_ENGINES,
  pinBlocksUpdate,
  resolveEngineVersion,
} from './scanner/package-json-extras'
export type { ResolutionPin } from './scanner/package-json-extras'
export {
  applyCatalogUpdate,
  isCatalogReference,
  parseWorkspaceCatalogs,
  resolveCatalogReference,
} from './scanner/workspace-catalog'
export type { CatalogEntry, WorkspaceCatalogs } from './scanner/workspace-catalog'
export {
  appendHistory,
  computeDeltas,
  computeMetrics,
  findPrevious,
  HISTORY_LIMIT,
  HISTORY_PATH,
  loadHistory,
  parseHistory,
  PERIOD_DAYS,
  REPORT_MARKER,
  REPORT_PERIODS,
  renderReport,
  withNarrative,
} from './reports'
export type {
  ActivityMetrics,
  Delta,
  HealthMetrics,
  MetricsInput,
  ReportMetrics,
  ReportPeriod,
} from './reports'
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

// Agent runtime
export * from './agent'

// AI code review
export * from './review'

// Static analysis
export * from './analysis'

// Comment commands
export * from './commands'

// CI failure analysis
export * from './ci'

// Merge gates
export * from './gates'

// Issue enrichment
export * from './issues'

// Package rules engine
export * from './rules'

// AI-assisted major upgrades
export * from './upgrades'

// Runtime events and notifications
export * from './events'
