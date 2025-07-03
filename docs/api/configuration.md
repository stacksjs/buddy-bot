# Configuration Types

TypeScript interfaces and types for buddy-bot configuration.

## Core Configuration

### `BuddyBotConfig`

Main configuration interface for buddy-bot.

```typescript
interface BuddyBotConfig {
  /** Repository configuration */
  repository?: RepositoryConfig

  /** Package management settings */
  packages?: PackageConfig

  /** Pull request configuration */
  pullRequest?: PullRequestConfig

  /** Scheduling configuration */
  schedule?: ScheduleConfig

  /** Release notes configuration */
  releaseNotes?: ReleaseNotesConfig

  /** Git provider settings */
  git?: GitProviderConfig

  /** Registry configuration */
  registries?: RegistryConfig[]

  /** Global settings */
  global?: GlobalConfig
}
```

## Repository Configuration

### `RepositoryConfig`

Repository-specific settings.

```typescript
interface RepositoryConfig {
  /** Repository owner/organization */
  owner: string

  /** Repository name */
  name: string

  /** Default branch */
  defaultBranch?: string

  /** Repository URL */
  url?: string

  /** Clone configuration */
  clone?: {
    depth?: number
    sparse?: boolean
    submodules?: boolean
  }
}
```

## Package Configuration

### `PackageConfig`

Package management and update configuration.

```typescript
interface PackageConfig {
  /** Update strategy */
  strategy?: UpdateStrategy

  /** Package manager to use */
  manager?: PackageManager

  /** Packages to ignore */
  ignore?: string[]

  /** Package groups */
  groups?: PackageGroup[]

  /** Workspace configuration */
  workspaces?: WorkspaceConfig

  /** Version constraints */
  constraints?: Record<string, string>

  /** Include/exclude patterns */
  include?: string[]
  exclude?: string[]
}
```

### `UpdateStrategy`

Available update strategies.

```typescript
type UpdateStrategy = 'patch' | 'minor' | 'major' | 'all'
```

### `PackageManager`

Supported package managers.

```typescript
type PackageManager = 'bun' | 'npm' | 'yarn' | 'pnpm' | 'auto'
```

### `PackageGroup`

Package grouping configuration.

```typescript
interface PackageGroup {
  /** Group name */
  name: string

  /** Packages in group */
  packages: string[]

  /** Group-specific strategy */
  strategy?: UpdateStrategy

  /** Group labels */
  labels?: string[]

  /** Group reviewers */
  reviewers?: string[]

  /** Auto-merge for group */
  autoMerge?: boolean

  /** Group description */
  description?: string
}
```

### `WorkspaceConfig`

Monorepo workspace configuration.

```typescript
interface WorkspaceConfig {
  /** Auto-detect workspaces */
  autoDetect?: boolean

  /** Workspace patterns */
  patterns?: string[]

  /** Workspace-specific configs */
  configs?: Record<string, WorkspacePackageConfig>

  /** Coordination settings */
  coordination?: WorkspaceCoordination
}

interface WorkspacePackageConfig extends PackageConfig {
  /** Workspace path */
  path?: string

  /** Downstream workspaces */
  downstream?: string[]

  /** Requires testing */
  requiresTesting?: boolean
}

interface WorkspaceCoordination {
  /** Align shared dependencies */
  alignSharedDeps?: boolean

  /** Shared dependency groups */
  sharedGroups?: Record<string, SharedGroupConfig>

  /** Update ordering */
  updateOrder?: string[]
}
```

## Pull Request Configuration

### `PullRequestConfig`

Pull request generation settings.

```typescript
interface PullRequestConfig {
  /** PR title template */
  title?: string

  /** PR body template */
  body?: string

  /** PR labels */
  labels?: LabelConfig

  /** Assignees */
  assignees?: AssigneeConfig

  /** Reviewers */
  reviewers?: ReviewerConfig

  /** Auto-merge settings */
  autoMerge?: AutoMergeConfig

  /** Draft PR settings */
  draft?: boolean

  /** Branch naming */
  branchNaming?: BranchNamingConfig
}
```

### `LabelConfig`

Label configuration for pull requests.

```typescript
interface LabelConfig {
  /** Static labels (always applied) */
  static?: string[]

  /** Dynamic labeling rules */
  dynamic?: DynamicLabelConfig

  /** Pattern-based labels */
  patterns?: Record<string, string[]>

  /** Conditional labels */
  conditions?: LabelCondition[]
}

interface DynamicLabelConfig {
  /** Enable dynamic labeling */
  enabled?: boolean

  /** Update type labels */
  updateType?: Record<UpdateStrategy, string>

  /** Ecosystem detection */
  ecosystems?: Record<string, string[]>

  /** Custom rules */
  rules?: LabelRule[]
}

interface LabelCondition {
  /** Condition function */
  when: (pr: PullRequestContext) => boolean

  /** Labels to apply */
  apply: string[]
}

interface LabelRule {
  /** Rule condition */
  condition: string

  /** Label to apply */
  label: string
}
```

### `AssigneeConfig`

Assignee configuration.

```typescript
interface AssigneeConfig {
  /** Static assignees */
  static?: string[]

  /** Dynamic assignment rules */
  rules?: AssigneeRule[]

  /** Maximum assignees */
  maxAssignees?: number

  /** Require assignee */
  requiresAssignee?: boolean
}

interface AssigneeRule {
  /** Rule condition */
  condition: string

  /** Assignees to assign */
  assignees: string[]
}
```

### `ReviewerConfig`

Reviewer configuration.

```typescript
interface ReviewerConfig {
  /** Default reviewers */
  default?: string[]

  /** Package-based reviewers */
  packageOwners?: Record<string, string[]>

  /** Team configuration */
  teams?: Record<string, TeamConfig>

  /** Review requirements */
  requirements?: ReviewRequirements

  /** Fallback reviewers */
  fallback?: string[]
}

interface TeamConfig {
  /** Team members */
  members: string[]

  /** Packages owned by team */
  packages: string[]

  /** Required reviews from team */
  requiredReviews?: number

  /** Auto-assign to team */
  autoAssign?: boolean
}

interface ReviewRequirements {
  /** Minimum required reviews */
  required?: number

  /** Count team reviews */
  teamReviews?: boolean

  /** Dismiss stale reviews */
  dismissStale?: boolean
}
```

### `AutoMergeConfig`

Auto-merge configuration.

```typescript
interface AutoMergeConfig {
  /** Enable auto-merge */
  enabled?: boolean

  /** Required status checks */
  requiredChecks?: string[]

  /** Merge method */
  method?: MergeMethod

  /** Conditions for auto-merge */
  conditions?: AutoMergeCondition[]

  /** Delay before merge */
  delay?: number
}

type MergeMethod = 'merge' | 'squash' | 'rebase'

interface AutoMergeCondition {
  /** Update type */
  updateType?: UpdateStrategy

  /** Package patterns */
  packages?: string[]

  /** Labels required */
  labels?: string[]

  /** Reviews required */
  reviews?: number
}
```

### `BranchNamingConfig`

Branch naming configuration.

```typescript
interface BranchNamingConfig {
  /** Branch prefix */
  prefix?: string

  /** Include update type */
  includeUpdateType?: boolean

  /** Include package count */
  includePackageCount?: boolean

  /** Custom template */
  template?: string

  /** Separator character */
  separator?: string
}
```

## Schedule Configuration

### `ScheduleConfig`

Scheduling and automation settings.

```typescript
interface ScheduleConfig {
  /** Cron expression */
  cron?: string

  /** Timezone */
  timezone?: string

  /** Enable scheduling */
  enabled?: boolean

  /** Multiple schedules */
  schedules?: NamedSchedule[]

  /** Environment-based scheduling */
  environments?: Record<string, EnvironmentSchedule>

  /** Trigger-based updates */
  triggers?: TriggerConfig
}

interface NamedSchedule {
  /** Schedule name */
  name: string

  /** Cron expression */
  cron: string

  /** Schedule-specific strategy */
  strategy?: UpdateStrategy

  /** Schedule labels */
  labels?: string[]

  /** Schedule reviewers */
  reviewers?: string[]

  /** Auto-merge for schedule */
  autoMerge?: boolean
}

interface EnvironmentSchedule extends NamedSchedule {
  /** Environment name */
  environment?: string

  /** Require approval */
  requireApproval?: boolean
}

interface TriggerConfig {
  /** Security triggers */
  security?: SecurityTrigger

  /** Major release triggers */
  majorRelease?: MajorReleaseTrigger

  /** Batch threshold triggers */
  batchThreshold?: BatchThresholdTrigger
}
```

## Release Notes Configuration

### `ReleaseNotesConfig`

Release notes extraction and formatting.

```typescript
interface ReleaseNotesConfig {
  /** Data sources */
  sources?: ReleaseNotesSource

  /** Content formatting */
  formatting?: ReleaseNotesFormatting

  /** Template configuration */
  template?: ReleaseNotesTemplate

  /** Aggregation settings */
  aggregation?: ReleaseNotesAggregation

  /** Caching configuration */
  caching?: CacheConfig
}

interface ReleaseNotesSource {
  /** GitHub releases */
  githubReleases?: GitHubReleasesConfig

  /** Changelog files */
  changelog?: ChangelogConfig

  /** NPM registry */
  npmRegistry?: NpmRegistryConfig

  /** Git commits */
  gitCommits?: GitCommitsConfig
}

interface ReleaseNotesFormatting {
  /** Markdown processing */
  markdown?: MarkdownConfig

  /** Content filters */
  filters?: ContentFilters

  /** Content enhancement */
  enhance?: ContentEnhancement
}

interface ReleaseNotesTemplate {
  /** Header template */
  header?: string

  /** Package section template */
  packageSection?: string

  /** Footer template */
  footer?: string

  /** Empty state message */
  empty?: string

  /** Error message */
  error?: string
}
```

## Git Provider Configuration

### `GitProviderConfig`

Git provider settings.

```typescript
interface GitProviderConfig {
  /** Provider type */
  provider: GitProvider

  /** Provider-specific settings */
  github?: GitHubConfig
  gitlab?: GitLabConfig

  /** Authentication */
  auth?: AuthConfig

  /** API configuration */
  api?: ApiConfig
}

type GitProvider = 'github' | 'gitlab'

interface GitHubConfig {
  /** GitHub API URL */
  apiUrl?: string

  /** GitHub Enterprise URL */
  baseUrl?: string

  /** App ID for GitHub App */
  appId?: string

  /** Installation ID */
  installationId?: string

  /** Private key path */
  privateKeyPath?: string
}

interface GitLabConfig {
  /** GitLab instance URL */
  url?: string

  /** Project ID */
  projectId?: number

  /** Group ID */
  groupId?: number
}

interface AuthConfig {
  /** Personal access token */
  token?: string

  /** Token environment variable */
  tokenEnv?: string

  /** OAuth configuration */
  oauth?: OAuthConfig
}

interface ApiConfig {
  /** Request timeout */
  timeout?: number

  /** Retry attempts */
  retries?: number

  /** Rate limiting */
  rateLimit?: RateLimitConfig
}
```

## Registry Configuration

### `RegistryConfig`

Package registry settings.

```typescript
interface RegistryConfig {
  /** Registry name */
  name: string

  /** Registry URL */
  url: string

  /** Authentication token */
  token?: string

  /** Scope for scoped registries */
  scope?: string

  /** Registry type */
  type?: RegistryType

  /** Cache configuration */
  cache?: CacheConfig
}

type RegistryType = 'npm' | 'github' | 'private'
```

## Global Configuration

### `GlobalConfig`

Global settings and defaults.

```typescript
interface GlobalConfig {
  /** Verbose logging */
  verbose?: boolean

  /** Dry run mode */
  dryRun?: boolean

  /** Concurrency limit */
  concurrency?: number

  /** Timeout settings */
  timeout?: number

  /** Error handling */
  errorHandling?: ErrorHandlingConfig

  /** Performance settings */
  performance?: PerformanceConfig
}

interface ErrorHandlingConfig {
  /** Retry configuration */
  retry?: RetryConfig

  /** Fallback strategies */
  fallback?: FallbackConfig

  /** Error reporting */
  reporting?: ErrorReportingConfig
}

interface PerformanceConfig {
  /** Caching strategy */
  cache?: CacheStrategy

  /** Parallel processing */
  parallel?: ParallelConfig

  /** Memory management */
  memory?: MemoryConfig
}
```

## Utility Types

### `PullRequestContext`

Context object passed to conditional functions.

```typescript
interface PullRequestContext {
  /** Packages being updated */
  packages: PackageUpdate[]

  /** Update type */
  updateType: UpdateStrategy

  /** Total package count */
  packageCount: number

  /** Has breaking changes */
  hasBreakingChanges: boolean

  /** Is security update */
  isSecurityUpdate: boolean

  /** Repository information */
  repository: RepositoryContext
}

interface PackageUpdate {
  /** Package name */
  name: string

  /** Current version */
  currentVersion: string

  /** Target version */
  targetVersion: string

  /** Update type */
  updateType: UpdateStrategy

  /** Has breaking changes */
  hasBreakingChanges: boolean

  /** Is dev dependency */
  isDevDependency: boolean

  /** Release notes */
  releaseNotes?: string
}
```

### Helper Types

```typescript
/** Deep partial type */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/** Configuration with environment overrides */
type ConfigWithEnv<T> = T & {
  env?: Record<string, DeepPartial<T>>
}

/** Conditional configuration */
type ConditionalConfig<T> = T | ((context: any) => T)
```

## Configuration Validation

### `validateConfig`

Validate configuration object.

```typescript
function validateConfig(config: BuddyBotConfig): ValidationResult

interface ValidationResult {
  /** Is configuration valid */
  valid: boolean

  /** Validation errors */
  errors: ValidationError[]

  /** Validation warnings */
  warnings: ValidationWarning[]
}

interface ValidationError {
  /** Error path */
  path: string

  /** Error message */
  message: string

  /** Error code */
  code: string
}
```

## Example Configurations

### Basic Configuration

```typescript
import type { BuddyBotConfig } from 'buddy-bot'

const config: BuddyBotConfig = {
  repository: {
    owner: 'myorg',
    name: 'myproject'
  },
  packages: {
    strategy: 'minor',
    ignore: ['react']
  },
  pullRequest: {
    labels: {
      static: ['dependencies']
    },
    reviewers: {
      default: ['team-lead']
    }
  }
}

export default config
```

### Advanced Configuration

```typescript
import type { BuddyBotConfig } from 'buddy-bot'

const config: BuddyBotConfig = {
  packages: {
    strategy: 'minor',
    groups: [
      {
        name: 'React Ecosystem',
        packages: ['react', 'react-dom'],
        strategy: 'patch',
        reviewers: ['frontend-team']
      }
    ],
    workspaces: {
      autoDetect: true,
      configs: {
        'packages/ui': {
          strategy: 'patch',
          autoMerge: true
        }
      }
    }
  },
  pullRequest: {
    labels: {
      dynamic: {
        enabled: true,
        updateType: {
          patch: 'patch-update',
          minor: 'minor-update',
          major: 'major-update'
        }
      }
    },
    autoMerge: {
      enabled: true,
      conditions: [
        {
          updateType: 'patch',
          labels: ['auto-merge-approved']
        }
      ]
    }
  },
  schedule: {
    schedules: [
      {
        name: 'security',
        cron: '0 */6 * * *',
        strategy: 'patch',
        autoMerge: true
      },
      {
        name: 'weekly',
        cron: '0 2 * * 1',
        strategy: 'minor'
      }
    ]
  }
}

export default config
```

See [Configuration Guide](/config) for detailed configuration examples and best practices.
