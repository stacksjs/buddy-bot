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
      conditions: ['patch-only', 'ci-passing'],
    },
  },

  // Scheduling configuration
  schedule: {
    cron: '0 2 * * 1', // Weekly on Monday at 2 AM
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
        packages: ['jest', '@types/jest', 'testing-library/*'],
        strategy: 'minor',
      },
    ],
  },
}
```

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
        schedule: '0 */6 * * *', // Every 6 hours
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
| `provider` | `'github' \| 'gitlab' \| 'bitbucket'` | Git provider | Required |
| `owner` | `string` | Repository owner/organization | Required |
| `name` | `string` | Repository name | Required |
| `baseBranch` | `string` | Base branch for PRs | `'main'` |
| `token` | `string` | Access token (use env var) | `undefined` |

### Package Settings

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `strategy` | `'major' \| 'minor' \| 'patch' \| 'all'` | Update strategy | `'all'` |
| `ignore` | `string[]` | Packages to ignore | `[]` |
| `pin` | `Record<string, string>` | Pin packages to versions | `{}` |
| `groups` | `PackageGroup[]` | Package groupings | `undefined` |

### Pull Request Settings

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `reviewers` | `string[]` | GitHub usernames for review | `[]` |
| `assignees` | `string[]` | GitHub usernames to assign | `[]` |
| `labels` | `string[]` | Labels to apply | `['dependencies']` |
| `autoMerge` | `AutoMergeConfig` | Auto-merge configuration | `undefined` |

## Environment Variables

Buddy uses these environment variables:

```bash
# Required for GitHub operations
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Optional: Alternative token name
GH_TOKEN=ghp_xxxxxxxxxxxx

# Optional: Custom registry URL
NPM_REGISTRY_URL=https://registry.npmjs.org

# Optional: Bun configuration
BUN_CONFIG_NO_CACHE=false
```

## Configuration Validation

Buddy validates your configuration on startup:

```bash
# Check configuration validity
buddy-bot scan --verbose

# Common validation errors:
# ❌ Repository configuration required for PR creation
# ❌ Invalid strategy: must be major|minor|patch|all
# ❌ Invalid cron expression in schedule
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
        packages: ['react*', 'vue*'],
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
- **deps.yaml** / **deps.yml** - Launchpad/pkgx dependency declarations
- **dependencies.yaml** / **dependencies.yml** - Alternative format
- **pkgx.yaml** / **pkgx.yml** - pkgx-specific files
- **.deps.yaml** / **.deps.yml** - Hidden configuration files
- Managed via `ts-pkgx` library integration

### GitHub Actions

#### Workflow Files
- **.github/workflows/*.yml** - GitHub Actions workflow files
- **.github/workflows/*.yaml** - Alternative YAML extension
- Managed via GitHub releases API

#### Action Detection
Buddy automatically detects `uses:` statements in workflow files:

```yaml
# All these formats are supported:
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
