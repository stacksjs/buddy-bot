# Configuration

Buddy can be configured using a `buddy-bot.config.ts` _(or `buddy-bot.config.js`)_ file and it will be automatically loaded when running buddy commands.

Buddy automatically detects and updates multiple dependency file formats including `package.json`, pkgx dependency files (`deps.yaml`, `pkgx.yaml`), Launchpad dependency files that use the same registry format, and GitHub Actions workflow dependencies.

## Basic Configuration

```typescript
// buddy-bot.config.ts
import type { BuddyBotConfig } from 'buddy-bot'

const config: BuddyBotConfig = {
  // Enable verbose logging
  verbose: true,

  // Repository configuration (required for PR creation)
  repository: {
    provider: 'github',
    owner: 'your-org',
    name: 'your-repo',
    baseBranch: 'main', // optional, defaults to 'main'
  },

  // Package update configuration
  packages: {
    strategy: 'patch', // 'major' | 'minor' | 'patch' | 'all'
    ignore: [
      '@types/node', // Ignore specific packages
      'eslint', // Keep manual control
      'actions/checkout', // Ignore specific GitHub Actions
    ],
    pin: {
      react: '^18.0.0', // Pin to specific version ranges
    },
  },

  // Pull request configuration
  pullRequest: {
    reviewers: ['team-lead', 'senior-dev'],
    assignees: ['maintainer'],
    labels: ['dependencies', 'automated'],
    autoMerge: {
      enabled: true,
      strategy: 'squash',
      conditions: ['patch-only'],
    },
  },

  // Scheduling configuration
  schedule: {
    cron: '0 2 _ _ 1', // Weekly on Monday at 2 AM
    timezone: 'UTC',
  },
}

export default config
```

## Advanced Configuration

### Dependency File Support

Buddy automatically scans your project for various dependency file formats:

```typescript
// Buddy automatically detects these file types:
const supportedFiles = [
  'package.json', // npm dependencies
  'deps.yaml', // Launchpad/pkgx dependencies
  'deps.yml', // Launchpad/pkgx dependencies (alternative extension)
  'dependencies.yaml', // Alternative dependency format
  'dependencies.yml', // Alternative dependency format
  'pkgx.yaml', // pkgx-specific dependencies
  'pkgx.yml', // pkgx-specific dependencies
  '.deps.yaml', // Hidden dependency configuration
  '.deps.yml', // Hidden dependency configuration
]
```

All dependency files are parsed using the `ts-pkgx` library and updates are applied while preserving formatting, comments, and version prefixes (`^`, `~`, `>=`, etc.).

### Package Groups

Organize related packages for coordinated updates:

```typescript
const config: BuddyBotConfig = {
  packages: {
    strategy: 'all',
    groups: [
      {
        name: 'React Ecosystem',
        packages: ['react', 'react-dom', '@types/react'],
        strategy: 'minor',
      },
      {
        name: 'Build Tools',
        packages: ['typescript', 'vite', 'rollup'],
        strategy: 'patch',
      },
      {
        name: 'Testing',
        packages: ['jest', '@types/jest', 'testing-library/_'],
        strategy: 'minor',
      },
    ],
  },
}
```

### Package Rules

Groups handle "these packages travel together". Rules handle everything else:
conditional labels, reviewers, auto-merge, priorities and holds, matched on any
combination of package name, ecosystem, dependency type, file path, update type
and installed version.

Rules are evaluated in order. Later matches override earlier ones **per field**,
so a broad rule can set a default and a narrow one refine it. List effects —
labels, reviewers, assignees — accumulate instead of replacing, because a
package matching both a "security" and a "frontend" rule should carry both sets
rather than whichever happened to be last.

#### Matchers

All matchers present on a rule must match (AND within a rule).

| Matcher               | Matches on                                              |
| --------------------- | ------------------------------------------------------- |
| `matchPackages`       | Package names or globs (`@types/_`)                     |
| `matchEcosystems`     | `npm`, `composer`, `github-actions`, `docker`, `pkgx`, `zig` |
| `matchDepTypes`       | `dependencies`, `devDependencies`, `peerDependencies`, … |
| `matchUpdateTypes`    | `major`, `minor`, `patch`                               |
| `matchFiles`          | Globs on the manifest path, for monorepo directories    |
| `matchCurrentVersion` | Semver range the _installed_ version must satisfy       |
| `schedule`            | Cron window during which the rule applies               |

A rule with no matchers applies to every update. Configuration validation
rejects that unless you write `matchPackages: ['_']`, because a matcherless
rule is almost always a typo'd matcher — and a typo does not disable a rule, it
widens it.

#### Effects

| Effect              | Does                                                     |
| ------------------- | -------------------------------------------------------- |
| `enabled: false`    | Drops matching updates entirely                          |
| `strategy`          | Narrows what may be proposed, independent of the global   |
| `groupName`         | Puts matching updates in a named group                    |
| `labels`            | Adds labels to the pull request                           |
| `reviewers`         | Requests review, unioned with `pullRequest.reviewers`     |
| `assignees`         | Assigns, unioned with `pullRequest.assignees`             |
| `autoMerge`         | Allows unattended merge — see the caveat below            |
| `autoMigrate`       | Attempts the migration for matching majors                |
| `minimumReleaseAge` | Minutes a version must have been published                |
| `prPriority`        | Ordering within `maxPRsPerRun`; higher goes first         |

`prPriority` is applied **before** the per-run cap, so a high-priority group
survives a cap that would otherwise have cut it.

`autoMerge` resolves conservatively across a group: **every** update in the pull
request must allow it. One package that must not merge unattended holds back the
whole PR containing it. `autoMigrate` resolves the other way — one package
opting in is enough, since migrating what can be migrated leaves everything else
exactly as it would have been.

#### Cookbook

**Hold back majors on one package** while everything else updates normally:

```typescript
rules: [
  { matchPackages: ['react', 'react-dom'], matchUpdateTypes: ['major'], enabled: false },
]
```

**Auto-merge types-only patches**, keeping everything else manual:

```typescript
rules: [
  {
    matchPackages: ['@types/*'],
    matchUpdateTypes: ['patch'],
    autoMerge: true,
    labels: ['types', 'automerge'],
  },
]
```

**Per-workspace reviewers** in a monorepo:

```typescript
rules: [
  { matchFiles: ['packages/api/**'], reviewers: ['backend-team'] },
  { matchFiles: ['packages/web/**'], reviewers: ['frontend-team'] },
]
```

**Weekend-only majors** — the schedule is a _window_, not a firing minute, so a
Tuesday run holds these back and a Saturday run lets them through:

```typescript
rules: [
  {
    matchUpdateTypes: ['major'],
    schedule: '0 0-23 _ _ 6,0',
    scheduleTimezone: 'Europe/Berlin',
  },
]
```

**Hold a legacy version series** while letting the modern one move:

```typescript
rules: [
  { matchPackages: ['vue'], matchCurrentVersion: '<3.0.0', enabled: false },
]
```

**Prioritise security-relevant dependencies** so they survive the per-run cap:

```typescript
rules: [
  { matchPackages: ['*'], prPriority: 0 },
  { matchDepTypes: ['dependencies'], prPriority: 10, labels: ['runtime'] },
]
```

#### Migrating from Renovate

`buddy-bot setup` converts Renovate `packageRules` automatically.
`matchPackageNames`, `matchPackagePrefixes`, `matchDepTypes`, `matchFileNames`,
`matchManagers`, `matchCurrentVersion`, `automerge`, `labels`, `reviewers`,
`assignees`, `groupName`, `prPriority` and `minimumReleaseAge` all map across.

Three things do not, and the migration report names each one rather than
approximating it:

- **Renovate schedules** are natural language (`"after 10pm every weekday"`);

  buddy-bot rules take cron. Translating prose would be guessing.

- **Update types** Renovate has and buddy-bot does not — `digest`, `pin`,

  `lockFileMaintenance`, `rollback`, `replacement`.

- **`matchPackagePatterns` that use real regex features.** Anchored prefixes

  (`^@types/`) convert exactly; anything else is copied verbatim with a warning,
  because a rule that silently matches the wrong packages is worse than one you
  have to rewrite.

### Custom PR Templates

Customize pull request formatting:

```typescript
const config: BuddyBotConfig = {
  pullRequest: {
    titleFormat: 'chore(deps): {updateType} {packages}',
    commitMessageFormat: 'chore(deps): update {packages}',
    bodyTemplate: `
# 🤖 Automated Dependency Update

{updateTable}

## 📋 Changes
{releaseNotes}

## 🔧 Configuration

- Strategy: {strategy}
- Packages: {packageCount}
- Labels: {labels}

    `,
  },
}
```

### Workflow Generation

Configure GitHub Actions workflow generation:

```typescript
const config: BuddyBotConfig = {
  workflows: {
    enabled: true,
    outputDir: '.github/workflows',
    templates: {
      daily: true,
      weekly: true,
      monthly: false,
      comprehensive: true,
      docker: false,
      monorepo: false,
    },
    custom: [
      {
        name: 'Security Updates',
        schedule: '0 _/6 _ _ _', // Every 6 hours
        strategy: 'patch',
        autoMerge: true,
        reviewers: ['security-team'],
        labels: ['security', 'dependencies'],
      },
    ],
  },
}
```

## Configuration Options

### Repository Settings

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `provider` | `'github'` | Git provider. GitHub is the only implemented provider | Required |
| `owner` | `string` | Repository owner/organization | Required |
| `name` | `string` | Repository name | Required |
| `baseBranch` | `string` | Base branch for PRs | `'main'` |
| `token` | `string` | Access token (use env var) | `undefined` |
| `apiUrl` | `string` | REST API base URL, for GitHub Enterprise Server | `$GITHUB_API_URL`, else `<https://api.github.com>` |
| `serverUrl` | `string` | Web base URL used for links | `$GITHUB_SERVER_URL`, else `<https://github.com>` |

### Package Settings

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `strategy` | `'major' \| 'minor' \| 'patch' \| 'all'` | Update strategy | `'all'` |
| `ignore` | `string[]` | Packages to ignore | `[]` |
| `pin` | `Record<string, string>` | Pin packages to versions | `{}` |
| `groups` | `PackageGroup[]` | Package groupings | `undefined` |

### Logging

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `verbose` | `boolean` | Shorthand for `logLevel: 'debug'` | `false` |
| `logLevel` | `'silent' \| 'error' \| 'warn' \| 'info' \| 'debug'` | How much output to emit. Overrides `verbose` | `'info'` |

Set `logLevel: 'silent'` when embedding Buddy Bot in another tool that owns its
own output. `BUDDY_BOT_LOG_LEVEL` sets the same value from the environment.

### Registry Settings

For private or self-hosted package registries. When unset, Buddy Bot reads
`registry=` and `@scope:registry=` from the project and home `.npmrc`, matching
what npm itself would resolve.

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `registries.npm` | `string` | npm registry base URL | `.npmrc`, else `<https://registry.npmjs.org>` |
| `registries.npmScopes` | `Record<string, string>` | Per-scope registry overrides, keyed by scope including `@` | `.npmrc` |
| `registries.composer` | `string` | Composer/Packagist base URL | `<https://packagist.org>` |

```typescript
const config: BuddyBotConfig = {
  registries: {
    npm: 'https://npm.internal.acme.com',
    npmScopes: {
      '@acme': 'https://npm.acme.com',
    },
  },
}
```

### Security Settings

Buddy Bot checks every dependency against the [OSV.dev](https://osv.dev)
advisory database and annotates updates that resolve a known vulnerability.

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `security.enabled` | `boolean` | Query OSV for known vulnerabilities | `true` |
| `security.prioritize` | `boolean` | Put advisory fixes in their own PR, created first | `true` |
| `security.label` | `string` | Label applied to PRs that resolve an advisory | `'security'` |
| `security.minimumSeverity` | `'low' \| 'moderate' \| 'high' \| 'critical'` | Ignore advisories below this severity | `'low'` |

With `prioritize` on (the default), vulnerable dependencies are grouped into a
single `fix(deps): update vulnerable dependencies` PR that is created before any
routine update, so a `maxPRsPerRun` cap can never starve a security fix. The PR
body and the dependency dashboard both list the advisory ID, severity, and the
version that fixes it.

Set `security.enabled: false` for fully offline runs.

### Pull Request Settings

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `reviewers` | `string[]` | GitHub usernames for review | `[]` |
| `assignees` | `string[]` | GitHub usernames to assign | `[]` |
| `labels` | `string[]` | Labels to apply | `['dependencies']` |
| `autoMerge` | `AutoMergeConfig` | Auto-merge configuration, see [Auto-Merge](/features/auto-merge) | `undefined` |

### Pull Request Templates

`titleFormat`, `commitMessageFormat` and `bodyTemplate` accept `{token}` placeholders. Unknown tokens are left as-is rather than blanked, so a typo is visible instead of silently dropping content.

| Token | Available in | Value |
|---|---|---|
| `{title}` | title | The generated title |
| `{message}` | commit message | The generated commit message |
| `{group}` | all | Update group name, e.g. `Non-Major Updates` |
| `{count}`, `{package_count}` | all | Number of packages in the PR |
| `{strategy}` | all | Configured update strategy |
| `{update_type}` | all | Highest semver impact in the group |
| `{packages}` | all | Comma-separated package names |
| `{updates_table}` | body | The generated dependency tables and release notes |
| `{footer}` | body | The rebase/retry checkbox |

```ts
pullRequest: {
  titleFormat: '[deps] {title}',
  commitMessageFormat: 'deps: {message}',
  bodyTemplate: '# {group}\n\n{updates_table}\n\n{footer}',
}
```

A custom `bodyTemplate` replaces the generated prose, but the rebase checkbox and the machine-readable manifest are always appended — rebasing and auto-closing read the manifest, so a template cannot break the PR lifecycle.

### Resolution Drift

`packages.detectResolutionDrift` (default `true`) reports packages held below their latest version by a range declared elsewhere in the dependency tree. They appear on the [dependency dashboard](/features/dependency-dashboard) rather than as pull requests, because no change to this repository can move them.

### Pinning Packages

`packages.pin` holds a package at an exact version. A pin is both a ceiling and a floor: updates past the pin are dropped, and a package sitting somewhere else has an update proposed that brings it back to the pin.

```ts
packages: {
  strategy: 'all',
  pin: {
    'typescript': '5.8.2',
    '@types/node': '20.11.0',
  },
}
```

Use `packages.ignore` instead when you want a package left alone entirely.

## Environment Variables

Buddy uses these environment variables:

```bash
# Required for GitHub operations
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Optional: Alternative token name
GH_TOKEN=ghp_xxxxxxxxxxxx

# Optional: alternative token, preferred when set (needs `workflow` scope)
BUDDY_BOT_TOKEN=ghp_xxxxxxxxxxxx

# Optional: GitHub Enterprise Server. GitHub Actions sets both automatically
GITHUB_API_URL=https://github.acme.com/api/v3
GITHUB_SERVER_URL=https://github.acme.com

# Optional: custom npm registry (also read from .npmrc)
NPM_CONFIG_REGISTRY=https://npm.acme.com

# Optional: Composer registry
COMPOSER_REGISTRY_URL=https://packagist.acme.com

# Optional: lifts Docker Hub's anonymous rate limit
DOCKERHUB_TOKEN=dckr_pat_xxxxxxxxxxxx

# Optional: output verbosity (silent|error|warn|info|debug)
BUDDY_BOT_LOG_LEVEL=info

# Optional: per-request HTTP timeout in milliseconds (default: 30000)
BUDDY_HTTP_TIMEOUT_MS=30000

# Optional: Bun configuration
BUN_CONFIG_NO_CACHE=false
```

## GitHub Enterprise Server

Buddy Bot runs unmodified against GitHub Enterprise Server. On a GHES runner,
GitHub Actions exports `GITHUB_API_URL` and `GITHUB_SERVER_URL` automatically,
so no configuration is needed. Outside Actions, set them explicitly:

```typescript
const config: BuddyBotConfig = {
  repository: {
    provider: 'github',
    owner: 'acme',
    name: 'app',
    apiUrl: 'https://github.acme.com/api/v3',
    serverUrl: 'https://github.acme.com',
  },
}
```

## Configuration Validation

Buddy Bot validates your configuration when it loads, before any network or git
work happens, and reports every problem it finds at once:

```bash
buddy-bot scan
```

```text
Invalid buddy-bot configuration (2 issues):
  • packages.strategy: expected one of "major", "minor", "patch", "all", got "minr"
  • packages.groups[0].patterns: expected a non-empty array of patterns, got []
```

Validation covers update strategies, package groups, cron expressions, registry
and API URLs, severities, log levels, and the numeric bounds on
`maxPRsPerRun`, `minimumReleaseAge`, and the release-notes limits.

You can also run it yourself:

```typescript
import { formatConfigIssues, validateConfig } from 'buddy-bot'

const issues = validateConfig(config)
if (issues.length > 0)
  console.error(formatConfigIssues(issues))
```

## Multiple Configurations

For different environments or workflows:

```typescript
// buddy-bot.config.ts
const isDev = process.env.NODE_ENV === 'development'
const isCI = process.env.CI === 'true'

const config: BuddyBotConfig = {
  verbose: isDev,
  packages: {
    strategy: isCI ? 'patch' : 'all',
    ignore: isDev ? [] : ['@types/node'],
  },
  pullRequest: {
    autoMerge: {
      enabled: isCI,
      strategy: 'squash',
    },
  },
}

export default config
```

## TypeScript Support

Full TypeScript support with type checking:

```typescript
import type { BuddyBotConfig, PackageGroup } from 'buddy-bot'

// Type-safe configuration
const config: BuddyBotConfig = {
  // TypeScript will validate all options
  packages: {
    strategy: 'patch', // ✅ Valid
    // strategy: 'invalid', // ❌ TypeScript error
  },
}

// Custom package groups with types
const groups: PackageGroup[] = [
  {
    name: 'Frontend',
    packages: ['react', 'vue'],
    strategy: 'minor',
  },
]
```

## Configuration Examples

### Conservative Project

```typescript
export default {
  packages: {
    strategy: 'patch',
    ignore: ['react', 'vue'], // Keep frameworks stable
  },
  pullRequest: {
    reviewers: ['tech-lead'],
    autoMerge: { enabled: false }, // Manual review required
  },
} satisfies BuddyBotConfig
```

### Aggressive Updates

```typescript
export default {
  packages: {
    strategy: 'all',
    groups: [
      {
        name: 'Core Dependencies',
        packages: ['react_', 'vue*'],
        strategy: 'minor', // More conservative for core
      },
    ],
  },
  pullRequest: {
    autoMerge: {
      enabled: true,
      strategy: 'squash',
      conditions: ['patch-only'],
    },
  },
} satisfies BuddyBotConfig
```

_Then run:_

```bash
buddy-bot update
```

## Supported Dependency Types

Buddy provides comprehensive dependency management across four categories:

### Package Dependencies

#### npm Ecosystem

- **package.json** - Traditional npm, Bun, yarn, pnpm dependencies
- Managed via `bun outdated` for accurate version detection

#### PHP/Composer Ecosystem

- **composer.json** - PHP dependencies from Packagist
- **composer.lock** - Lock file with exact versions
- Managed via `composer outdated` and Packagist API integration

#### pkgx/Launchpad Ecosystem

- **deps.yaml**/**deps.yml** - Launchpad/pkgx dependency declarations
- **dependencies.yaml**/**dependencies.yml** - Alternative format
- **pkgx.yaml**/**pkgx.yml** - pkgx-specific files
- **.deps.yaml**/**.deps.yml** - Hidden configuration files
- Managed via `ts-pkgx` library integration

### GitHub Actions

#### Workflow Files

- **.github/workflows/*.yml** - GitHub Actions workflow files
- **.github/workflows/*.yaml** - Alternative YAML extension
- Managed via GitHub releases API

#### Action Detection

Buddy automatically detects `uses:` statements in workflow files:

```yaml
# All these formats are supported
steps:

  - uses: actions/checkout@v4 # Standard format
  - uses: oven-sh/setup-bun@v2 # Quoted
  - uses: actions/cache@v4.1.0 # Single quoted
  - uses: crazy-max/ghaction-docker@v3 # Third-party

```

#### Excluded Actions

- Local actions: `./local-action`
- Docker actions: `docker://node:18`
- Actions without versions: `actions/checkout`

### Configuration Examples

#### Ignore Specific Packages

```typescript
const config: BuddyBotConfig = {
  packages: {
    ignore: [
      // npm packages
      'react', // Keep React version stable
      '@types/node', // Manual Node.js type updates

      // Composer packages
      'laravel/framework', // Skip Laravel updates
      'php', // Platform requirement (auto-skipped)

      // GitHub Actions
      'actions/checkout', // Skip action updates
      'oven-sh/setup-bun', // Keep specific version
    ],
  },
}
```

#### Strategy Application

Update strategies apply to all dependency types:

```typescript
const config: BuddyBotConfig = {
  packages: {
    strategy: 'patch', // Applies to npm, pkgx, AND GitHub Actions
  },
}
```

#### Pull Request Integration

All three dependency types appear in separate tables within pull requests, providing clear organization and appropriate metadata for each ecosystem.

To learn more, head over to the [documentation](https://buddy.sh/).
