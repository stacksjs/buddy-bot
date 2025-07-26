<p align="center"><img src="https://github.com/stacksjs/buddy/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# 🐶 Buddy Bot

> Automated dependency updates for the JavaScript and TypeScript ecosystem.

A modern, fast alternative to Dependabot and Renovate built for the JavaScript and TypeScript ecosystem. Buddy automatically scans your projects for outdated dependencies and creates well-formatted pull requests with detailed changelogs and metadata.

![Buddy Bot Pull Request Example](.github/art/screenshot.png)

## Features

- 🚀 **Lightning Fast**: Built with Bun & performance in mind
- 🎯 **Smart Updates**: Configurable update strategies _(major, minor, patch, all)_
- 📦 **Multi-Package Manager**: Supports Bun, npm, yarn, pnpm, pkgx, and Launchpad dependency files
- ⚡ **GitHub Actions**: Automatically updates workflow dependencies (`actions/checkout@v4`, etc.)
- 📊 **Dependency Dashboard**: Single GitHub issue with overview of all dependencies and open PRs
- 🔄 **Rebase Functionality**: Interactive checkbox to update PRs with latest dependency versions
- 🔍 **Intelligent Scanning**: Uses `bun outdated` and GitHub releases for accurate dependency detection
- 📋 **Flexible Grouping**: Group related packages for cleaner PRs
- 🎨 **Rich PR Format**: Three separate tables (npm, Launchpad/pkgx, GitHub Actions) with detailed metadata
- ⚙️ **Zero Config**: Works out of the box with sensible defaults
- 🔧 **Highly Configurable**: Customize everything via `buddy-bot.config.ts`

## Quick Start

```bash
# Install globally
bun add -g buddy-bot

# Interactive setup (recommended)
bunx buddy-bot setup

# Or run directly
bunx buddy-bot scan
```

## Usage

### Interactive Setup

The easiest way to get started is with the interactive setup command:

```bash
buddy-bot setup
```

This will guide you through creating GitHub Actions workflows for automated dependency updates. Choose from several presets:

- **Standard Project** - Daily patch updates, weekly minor updates, monthly major updates
- **High Frequency Updates** - Check for updates 4 times per day _(6AM, 12PM, 6PM, 12AM)_
- **Security Focused** - Frequent patch updates with security-first approach
- **Minimal Updates** - Weekly patch updates, monthly minor/major updates
- **Docker Project** - Optimized for containerized applications
- **Monorepo** - Multiple packages in a single repository
- **Development/Testing** - Manual trigger + every 5 minutes _(perfect for testing)_
- **Custom Configuration** - Create your own update schedule

### Command Line Interface

```bash
# Scan for dependency updates
buddy scan

# Scan with verbose output
buddy scan --verbose

# Create or update dependency dashboard
buddy dashboard --pin

# Check specific packages
buddy scan --packages "react,typescript,@types/node"

# Check packages with glob patterns
buddy scan --pattern "@types/*"

# Apply different update strategies
buddy scan --strategy minor
buddy scan --strategy patch

# Update dependencies and create PRs
buddy update --dry-run
buddy update

# Check for rebase requests and update PRs
buddy check-rebase
buddy check-rebase --dry-run
buddy check-rebase --verbose

# Get help
buddy help
```

### Configuration

Create a `buddy-bot.config.ts` file in your project root:

```typescript
import type { BuddyBotConfig } from 'buddy-bot'

const config: BuddyBotConfig = {
  verbose: false,

  // Repository settings for PR creation
  repository: {
    provider: 'github',
    owner: 'your-org',
    name: 'your-repo',
    token: process.env.GITHUB_TOKEN,
    baseBranch: 'main'
  },

  // Package update configuration
  packages: {
    strategy: 'all', // 'major' | 'minor' | 'patch' | 'all'
    ignore: [
      'legacy-package',
      '@types/node' // Example ignores
    ],
    groups: [
      {
        name: 'TypeScript Types',
        patterns: ['@types/*'],
        strategy: 'minor'
      },
      {
        name: 'ESLint Ecosystem',
        patterns: ['eslint*', '@typescript-eslint/*'],
        strategy: 'patch'
      }
    ]
  },

  // Pull request settings
  pullRequest: {
    titleFormat: 'chore(deps): {title}',
    commitMessageFormat: 'chore(deps): {message}',
    reviewers: ['maintainer1', 'maintainer2'],
    labels: ['dependencies', 'automated'],
    autoMerge: {
      enabled: true,
      strategy: 'squash', // 'merge', 'squash', or 'rebase'
      conditions: ['patch-only'] // Only auto-merge patch updates
    }
  },

  // Dependency dashboard settings
  dashboard: {
    enabled: true,
    title: 'Dependency Dashboard',
    pin: true,
    labels: ['dependencies', 'dashboard'],
    assignees: ['maintainer1'],
    showOpenPRs: true,
    showDetectedDependencies: true
  }
}

export default config
```

### Programmatic Usage

```typescript
import { Buddy, ConfigManager } from 'buddy-bot'

// Load configuration
const config = await ConfigManager.loadConfig()

// Create Buddy instance
const buddy = new Buddy(config)

// Scan for updates
const scanResult = await buddy.scanForUpdates()

console.log(`Found ${scanResult.updates.length} updates`)

// Check specific packages
const updates = await buddy.checkPackages(['react', 'typescript'])

// Create pull requests
if (scanResult.updates.length > 0) {
  await buddy.createPullRequests(scanResult)
}

// Create or update dependency dashboard
const dashboardIssue = await buddy.createOrUpdateDashboard()
console.log(`Dashboard updated: ${dashboardIssue.url}`)
```

## Dependency Dashboard

The dependency dashboard provides a centralized view of all your repository's dependencies and open pull requests in a single GitHub issue. Similar to Renovate's dependency dashboard, it gives you complete visibility into your dependency management.

### Key Features

- **📊 Single Overview**: All dependencies and PRs in one place
- **🔄 Interactive Controls**: Force retry/rebase PRs by checking boxes
- **📌 Pinnable Issue**: Keep dashboard at the top of your issues
- **🏷️ Smart Categorization**: Organized by npm, GitHub Actions, and dependency files
- **⚡ Auto-Updates**: Refreshes when dependencies change

## Rebase Functionality

Buddy Bot includes powerful rebase functionality that allows you to update existing pull requests with the latest dependency versions, similar to Renovate's rebase feature.

### How It Works

All Buddy Bot pull requests include a rebase checkbox at the bottom:

```markdown
---
 - [ ] <!-- rebase-check -->If you want to update/retry this PR, check this box
---
```

### Using the Rebase Feature

1. **Check the box**: In any Buddy Bot PR, check the rebase checkbox
2. **Automatic detection**: The rebase workflow runs every minute to detect checked boxes
3. **Updates applied**: The PR is automatically updated with the latest dependency versions
4. **Checkbox unchecked**: After successful rebase, the checkbox is automatically unchecked

### Rebase Command

You can also trigger rebase manually using the CLI:

```bash
# Check for PRs with rebase checkbox enabled and update them
buddy-bot check-rebase

# Dry run to see what would be rebased
buddy-bot check-rebase --dry-run

# With verbose output
buddy-bot check-rebase --verbose
```

### Automated Rebase Workflow

Buddy Bot includes a pre-built GitHub Actions workflow (`.github/workflows/buddy-bot-rebase.yml`) that:

- **🕐 Runs every minute**: Automatically checks for rebase requests
- **🔍 Scans all PRs**: Finds Buddy Bot PRs with checked rebase boxes
- **📦 Updates dependencies**: Re-scans for latest versions and updates files
- **📝 Updates PR content**: Refreshes PR title, body, and file changes
- **✅ Maintains workflow files**: Updates GitHub Actions workflows (requires proper permissions)

### Workflow File Permissions

For the rebase functionality to update GitHub Actions workflow files, you need proper permissions:

#### Option 1: Personal Access Token (Recommended)
1. Create a [Personal Access Token](https://github.com/settings/tokens) with `repo` and `workflow` scopes
2. Add it as a repository secret named `BUDDY_BOT_TOKEN`
3. The workflow automatically uses it when available

#### Option 2: Default GitHub Token (Limited)
- Uses `GITHUB_TOKEN` with limited permissions
- Cannot update workflow files (`.github/workflows/*.yml`)
- Still updates package.json, lock files, and dependency files

### What Gets Updated During Rebase

- ✅ **package.json** - npm/yarn/pnpm dependencies
- ✅ **Lock files** - package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb
- ✅ **Dependency files** - deps.yaml, dependencies.yaml, pkgx.yaml
- ✅ **GitHub Actions** - workflow files (with proper permissions)
- ✅ **PR content** - Updated title, body, and metadata

### Quick Start

```bash
# Create basic dashboard
buddy-bot dashboard

# Create pinned dashboard with custom title
buddy-bot dashboard --pin --title "My Dependencies"
```

### Automated Dashboard Updates

Buddy Bot includes a pre-built GitHub workflow (`.github/workflows/buddy-bot-dashboard.yml`) that automatically updates your dependency dashboard:

- **📅 Scheduled**: Runs Monday, Wednesday, Friday at 9 AM UTC
- **🖱️ Manual**: Trigger from Actions tab with custom options
- **📌 Auto-Pin**: Keeps dashboard pinned by default
- **🔍 Dry-Run**: Preview mode available

### Example Dashboard Output

The dashboard automatically organizes your dependencies and shows:

```markdown
## Open

The following updates have all been created. To force a retry/rebase of any, click on a checkbox below.

 - [ ] <!-- rebase-branch=buddy-bot/update-react-18 -->[chore(deps): update react to v18](../pull/123) (`react`)
 - [ ] <!-- rebase-branch=buddy-bot/update-types -->[chore(deps): update @types/node](../pull/124) (`@types/node`)

## Detected dependencies

<details><summary>npm</summary>
<blockquote>

<details><summary>package.json</summary>

 - `react ^17.0.0`
 - `typescript ^4.9.0`
 - `@types/node ^18.0.0`

</details>
</blockquote>
</details>

<details><summary>github-actions</summary>
<blockquote>

<details><summary>.github/workflows/ci.yml</summary>

 - `actions/checkout v3`
 - `oven-sh/setup-bun v1`

</details>
</blockquote>
</details>
```

## How It Works

Buddy leverages Bun's built-in capabilities for maximum performance:

1. **Fast Scanning**: Uses `bun outdated` to quickly identify outdated packages
2. **Smart Parsing**: Analyzes `package.json`, lock files, and dependency files across your project
3. **Dependency File Support**: Automatically detects and updates pkgx and Launchpad dependency files
4. **Intelligent Grouping**: Groups related packages to reduce PR noise
5. **Rich Metadata**: Fetches package metadata, release notes, and changelogs
6. **PR Generation**: Creates detailed pull requests with formatted content

### Supported Dependency Files

Buddy automatically detects and updates the following dependency file formats:

#### Package Dependencies
- **package.json** - Traditional npm dependencies
- **deps.yaml** / **deps.yml** - Launchpad/pkgx dependency declarations
- **dependencies.yaml** / **dependencies.yml** - Alternative dependency file format
- **pkgx.yaml** / **pkgx.yml** - pkgx-specific dependency files
- **.deps.yaml** / **.deps.yml** - Hidden dependency configuration files

#### GitHub Actions
- **.github/workflows/*.yml** - GitHub Actions workflow files
- **.github/workflows/*.yaml** - Alternative YAML extension

All dependency files are parsed using the `ts-pkgx` library to ensure compatibility with the pkgx registry ecosystem while maintaining support for tools like Launchpad that reuse the same registry format. GitHub Actions are detected by parsing `uses:` statements in workflow files and checking for updates via the GitHub releases API.

### Pull Request Format

Buddy generates comprehensive pull requests with **three separate dependency tables**:

#### 1. npm Dependencies
Full table with confidence badges, age, adoption metrics, and weekly download statistics:
```
| Package | Change | Age | Adoption | Passing | Confidence |
|---------|--------|-----|----------|---------|------------|
| lodash  | ^4.17.20 → ^4.17.21 | 📅 | 📈 | ✅ | 🔒 |
```

#### 2. Launchpad/pkgx Dependencies
Simplified table focusing on package updates and file locations:
```
| Package | Change | File | Status |
|---------|--------|------|--------|
| bun.com | ^1.2.16 → ^1.2.19 | deps.yaml | ✅ Available |
```

#### 3. GitHub Actions
Workflow automation updates with direct links to repositories:
```
| Action | Change | File | Status |
|--------|--------|------|--------|
| actions/checkout | v4 → v4.2.2 | ci.yml | ✅ Available |
| oven-sh/setup-bun | v2 → v2.0.2 | release.yml | ✅ Available |
```

Each table is followed by detailed release notes, changelogs, and package statistics tailored to the dependency type.

## Update Strategies

- **`all`**: Update all dependencies regardless of semver impact
- **`major`**: Only major version updates
- **`minor`**: Major and minor updates (no patch-only)
- **`patch`**: All updates (major, minor, and patch)

## Auto-Merge Configuration

Buddy supports configurable auto-merge for pull requests to reduce manual overhead:

```typescript
const config: BuddyBotConfig = {
  pullRequest: {
    autoMerge: {
      enabled: true,
      strategy: 'squash', // 'merge', 'squash', or 'rebase'
      conditions: ['patch-only'] // Optional: restrict to specific update types
    }
  }
}
```

### Auto-Merge Strategies

- **`squash`**: Squash commits and merge _(recommended for clean history)_
- **`merge`**: Create a merge commit _(preserves individual commits)_
- **`rebase`**: Rebase and merge _(linear history without merge commits)_

### Auto-Merge Conditions

- **`patch-only`**: Only auto-merge patch version updates _(safest)_
- **No conditions**: Auto-merge all updates _(use with caution)_

### Workflow-Specific Auto-Merge

Each preset configures auto-merge appropriately:

- **High Frequency Updates**: Auto-merge patch updates only _(6AM, 12PM, 6PM)_, manual review for minor updates _(12AM)_
- **Security Focused**: Auto-merge security patches every 6 hours
- **Standard Project**: Auto-merge daily patches, manual review for weekly/monthly updates
- **Development/Testing**: No auto-merge, dry-run by default, enhanced testing features.

## Development & Testing

The **Development/Testing** preset is specifically designed for testing and development environments:

### Features
- **⏰ Every 5 minutes**: Automated runs for rapid testing cycles
- **🖱️ Manual triggers**: Full control via GitHub Actions UI
- **🔍 Dry run by default**: Safe testing without making changes
- **📝 Verbose logging**: Detailed output for debugging
- **📦 Package-specific testing**: Test updates for specific packages
- **📊 Enhanced summaries**: Detailed test reports with context

### Manual Trigger Options
When running manually, you can customize:
- **Update strategy**: Choose patch, minor, major, or all updates
- **Dry run mode**: Preview changes without applying them
- **Specific packages**: Test updates for particular packages only
- **Verbose logging**: Control output detail level

### Perfect For
- 🧪 Testing new configurations
- 🔧 Debugging dependency issues
- 📈 Monitoring update frequency
- 🚀 Validating workflow changes
- 📋 Learning how Buddy Bot works

## Package Grouping

Group related packages to create cleaner, more focused pull requests:

```typescript
{
  groups: [
    {
      name: 'React Ecosystem',
      patterns: ['react*', '@types/react*'],
      strategy: 'minor'
    },
    {
      name: 'Development Tools',
      patterns: ['eslint*', 'prettier*', '@typescript-eslint/*'],
      strategy: 'patch'
    }
  ]
}
```

## Example Output

When Buddy finds updates, it creates PRs like:

```
chore(deps): update all non-major dependencies

This PR contains the following updates:

| Package | Change | Age | Adoption | Passing | Confidence |
|---|---|---|---|---|---|
| [typescript](https://www.typescriptlang.org/) | `^5.8.2` -> `^5.8.3` | [![age](https://developer.mend.io/api/mc/badges/age/npm/typescript/5.8.3?slim=true)](https://docs.renovatebot.com/merge-confidence/) | [![adoption](https://developer.mend.io/api/mc/badges/adoption/npm/typescript/5.8.3?slim=true)](https://docs.renovatebot.com/merge-confidence/) | [![passing](https://developer.mend.io/api/mc/badges/compatibility/npm/typescript/5.8.2/5.8.3?slim=true)](https://docs.renovatebot.com/merge-confidence/) | [![confidence](https://developer.mend.io/api/mc/badges/confidence/npm/typescript/5.8.2/5.8.3?slim=true)](https://docs.renovatebot.com/merge-confidence/) |

---

### Release Notes

<details>
<summary>microsoft/TypeScript (typescript)</summary>

### [`v5.8.3`](https://github.com/microsoft/TypeScript/releases/tag/v5.8.3)

[Compare Source](https://github.com/microsoft/TypeScript/compare/v5.8.2...v5.8.3)

##### Bug Fixes
- Fix issue with module resolution
- Improve error messages

</details>

---

### Configuration

📅 **Schedule**: Branch creation - At any time (no schedule defined), Automerge - At any time (no schedule defined).

🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.

♻ **Rebasing**: Whenever PR is behind base branch, or you tick the rebase/retry checkbox.

🔕 **Ignore**: Close this PR and you won't be reminded about this update again.

---

 - [ ] <!-- rebase-check -->If you want to update/retry this PR, check this box

---

This PR was generated by [Buddy](https://github.com/stacksjs/buddy-bot).
```

## Comparison with Alternatives

| Feature | Buddy | Dependabot | Renovate |
|---------|-------|------------|----------|
| **Speed** | ⚡ Bun-native | 🐌 Slower | 🐌 Slower |
| **Package Managers** | Bun, npm, yarn, pnpm, pkgx, Launchpad | Limited | Limited |
| **Configuration** | TypeScript, YAML, JSON/JS, package.json | YAML | JSON/JS |
| **Grouping** | ✅ Flexible | ✅ Basic | ✅ Advanced |
| **Zero Config** | ✅ Yes | ✅ Yes | ❌ Complex |
| **Self-hosted** | ✅ Yes | ❌ GitHub only | ✅ Yes |

## CI/CD Integration

### GitHub Actions

Buddy includes powerful GitHub Actions workflow templates for different automation strategies:

```yaml
# Basic daily patch updates
name: Daily Dependency Updates
on:
  schedule:
    - cron: '0 2 * * *' # 2 AM daily
jobs:
  update-deps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx buddy-bot update --strategy patch --verbose
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**🚀 Generate Advanced Workflows:**

```bash
# Generate comprehensive GitHub Actions workflows
buddy generate-workflows

# This creates:
# - buddy-comprehensive.yml (multi-strategy scheduling)
# - dependency-updates-daily.yml (patch updates)
# - dependency-updates-weekly.yml (minor updates)
# - dependency-updates-monthly.yml (major updates)
# - buddy-monorepo.yml (monorepo support)
# - buddy-docker.yml (Docker-based)
```

**🔥 Comprehensive Multi-Strategy Workflow:**

The comprehensive workflow automatically:
- **Daily 2 AM**: Patch updates (auto-mergeable)
- **Mon/Thu 2 AM**: Minor updates (review required)
- **1st of month 2 AM**: Major updates (review required)
- **Manual trigger**: Any strategy with dry-run option
- **Failure handling**: Auto-creates GitHub issues
- **Smart summaries**: Rich GitHub Actions summaries

### GitHub Actions Permissions Setup

⚠️ **Important**: For Buddy to create pull requests in GitHub Actions workflows, you need to enable the proper permissions:

#### Repository Settings
1. Go to your repository **Settings** → **Actions** → **General**
2. Under **"Workflow permissions"**, select **"Read and write permissions"**
3. ✅ Check **"Allow GitHub Actions to create and approve pull requests"**
4. Click **"Save"**

#### Organization Settings (if applicable)
If your repository is part of an organization, you may also need to enable organization-level permissions:
1. Go to your organization **Settings** → **Actions** → **General**
2. Configure the same permissions as above

#### Quick Setup Command
```bash
# Open GitHub settings pages directly
buddy open-settings

# Or manually visit:
# Repository: https://github.com/YOUR_ORG/YOUR_REPO/settings/actions
# Organization: https://github.com/organizations/YOUR_ORG/settings/actions
```

#### Troubleshooting
If you see errors like:
- `GitHub Actions is not permitted to create or approve pull requests`
- `GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)`

This indicates the permissions above need to be enabled. Both GitHub CLI and REST API methods require these permissions to create PRs from workflows.

For more details, see the [GitHub documentation on managing GitHub Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests).

## Testing

```bash
bun test
```

## Build From Source

```bash
bun run build
```

## Changelog

Please see our [releases](https://github.com/stacksjs/stacks/releases) page for more information on what has changed recently.

## Contributing

Please see the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where Stacks is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States 🌎

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Renovatebot](https://renovatebot.com/)
- [Dependabot](https://dependabot.com/)
- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](../../contributors)

And a special thanks to [Dan Scanlon](https://twitter.com/danscan) for donating the `stacks` name on npm ✨

## License

The MIT License (MIT). Please see [LICENSE](LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/buddy-bot?style=flat-square
[npm-version-href]: https://npmjs.com/package/buddy-bot
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/buddy/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/buddy/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/buddy/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/buddy -->
