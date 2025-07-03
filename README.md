<p align="center"><img src="https://github.com/stacksjs/buddy/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# Buddy

> Automated dependency updates for the JavaScript and TypeScript ecosystem.

A modern, fast alternative to Dependabot and Renovate built for the Bun ecosystem. Buddy automatically scans your projects for outdated dependencies and creates well-formatted pull requests with detailed changelogs and metadata.

## Features

- 🚀 **Lightning Fast**: Built on Bun with 20x faster semver operations
- 🎯 **Smart Updates**: Configurable update strategies (major, minor, patch, all)
- 📦 **Multi-Package Manager**: Supports Bun, npm, yarn, and pnpm
- 🔍 **Intelligent Scanning**: Uses `bun outdated` for accurate dependency detection
- 📋 **Flexible Grouping**: Group related packages for cleaner PRs
- 🎨 **Rich PR Format**: Detailed changelogs, release notes, and metadata
- ⚙️ **Zero Config**: Works out of the box with sensible defaults
- 🔧 **Highly Configurable**: Customize everything via `buddy-bot.config.ts`

## Quick Start

```bash
# Install globally
bun add -g buddy-bot

# Or run directly
bunx buddy-bot scan
```

## Usage

### Command Line Interface

```bash
# Scan for dependency updates
buddy scan

# Scan with verbose output
buddy scan --verbose

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
      strategy: 'squash',
      conditions: ['patch-only']
    }
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
```

## How It Works

Buddy leverages Bun's built-in capabilities for maximum performance:

1. **Fast Scanning**: Uses `bun outdated` to quickly identify outdated packages
2. **Smart Parsing**: Analyzes `package.json` and lock files across your project
3. **Intelligent Grouping**: Groups related packages to reduce PR noise
4. **Rich Metadata**: Fetches package metadata, release notes, and changelogs
5. **PR Generation**: Creates detailed pull requests with formatted content

### Bun Integration

Buddy is built specifically for the Bun ecosystem:

- **Bun Semver**: Uses Bun's native semver implementation (20x faster than node-semver)
- **Bun Outdated**: Leverages `bun outdated` for accurate dependency checking
- **Native Performance**: Built with Bun for maximum speed

## Update Strategies

- **`all`**: Update all dependencies regardless of semver impact
- **`major`**: Only major version updates
- **`minor`**: Major and minor updates (no patch-only)
- **`patch`**: All updates (major, minor, and patch)

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

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box

---

This PR was generated by [Buddy](https://github.com/stacksjs/buddy).
```

## Comparison with Alternatives

| Feature | Buddy | Dependabot | Renovate |
|---------|-------|------------|----------|
| **Speed** | ⚡ Bun-native | 🐌 Slower | 🐌 Slower |
| **Package Managers** | Bun, npm, yarn, pnpm | Limited | Most |
| **Configuration** | TypeScript config | YAML | JSON/JS |
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

## Testing

```bash
bun test
```

## Build From Source

```bash
bun run build
```

## Changelog

Please see our [releases](https://github.com/stacksjs/buddy/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

Two things are true: Stacks OSS will always stay open-source, and we do love to receive postcards from wherever Stacks is used! 🌍 _We also publish them on our website. And thank you, Spatie_

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/buddy-bot?style=flat-square
[npm-version-href]: https://npmjs.com/package/buddy-bot
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/buddy/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/buddy/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/buddy/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/buddy -->
