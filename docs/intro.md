<p align="center"><img src="https://github.com/stacksjs/buddy-bot/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

# Intelligent Dependency Management

> Automated dependency updates with professional pull requests, smart scheduling, and team integration.

Buddy-bot is a modern dependency management tool that automatically scans your project for outdated packages and creates professional pull requests with detailed release notes, impact analysis, and intelligent labeling. Built on Bun's lightning-fast package manager, it provides enterprise-grade automation for keeping your dependencies up-to-date.

## Key Features

- **🔍 Smart Scanning** - Lightning-fast dependency detection using Bun, ts-pkgx, and GitHub API
- **🤖 Automated PRs** - Professional pull requests with three separate dependency tables
- **📁 Multi-Format Support** - Handles package.json, pkgx, Launchpad dependency files, and GitHub Actions
- **🏷️ Dynamic Labeling** - Contextual labels based on update type and package ecosystem
- **👥 Team Integration** - Automatic reviewers, assignees, and team notifications
- **📅 Flexible Scheduling** - Cron-based automation with GitHub Actions integration
- **🔄 Interactive Rebasing** - Checkbox-based PR rebasing with conflict detection
- **📦 Package Grouping** - Coordinate related package updates for better change management
- **🛡️ Security Priority** - Prioritizes security updates with configurable strategies
- **🛠️ Simple Setup Experience** - Renovate-like interactive setup with validation and smart recommendations
- **🔍 Pre-flight Validation** - Environment checks, conflict detection, and prerequisite validation
- **📊 Smart Project Analysis** - Automatic project type detection with intelligent recommendations
- **📈 Progress Tracking** - Visual setup progress with step-by-step guidance and recovery capabilities

## 🚀 Quick Start

```bash
# Install buddy-bot
bun add --global buddy-bot

# Interactive setup (recommended)
buddy-bot setup

# Or scan for outdated packages
buddy-bot scan

# Create update pull requests
buddy-bot update
```

## 🛠️ Interactive Setup

The fastest way to get started is with the interactive setup command:

```bash
buddy-bot setup
```

This comprehensive setup wizard provides a **Renovate-like experience** that automatically configures your entire dependency management workflow:

### Setup Process

**🔍 Step 1: Repository Detection**
- Automatically detects your GitHub repository from git remote
- Validates repository access and configuration

**🔑 Step 2: GitHub Token Setup**
- Guides you through creating a Personal Access Token (PAT)
- Explains required scopes (`repo`, `workflow`) for full functionality
- Helps set up repository secrets for enhanced features

**🔧 Step 3: Repository Settings**
- Walks you through GitHub Actions permissions configuration
- Ensures proper workflow permissions for PR creation

**⚙️ Step 4: Workflow Configuration**
Choose from carefully crafted presets:
- **Standard Setup** - Dashboard updates 3x/week, balanced dependency updates
- **High Frequency** - Check for updates multiple times per day
- **Security Focused** - Frequent patch updates with security-first approach
- **Minimal Updates** - Weekly checks, lower frequency
- **Development/Testing** - Manual triggers + frequent checks for testing
- **Custom Configuration** - Create your own schedule

**📝 Step 5: Configuration Generation**
- Creates `buddy-bot.config.json` with your repository settings
- Includes sensible defaults and customization options

**🔄 Step 6: Workflow Generation**
Generates three core GitHub Actions workflows:
- `buddy-dashboard.yml` - Dependency Dashboard Management
- `buddy-check.yml` - Auto-rebase PR checker
- `buddy-update.yml` - Scheduled dependency updates

**🎯 Step 7: Final Instructions**
- Provides clear next steps with git commands
- Links to GitHub settings pages for easy configuration
- Explains token setup and repository permissions

### What You Get

After the enhanced setup completes, you'll have:
- ✅ **Complete automation** - Three production-ready workflows with validation
- ✅ **Professional dashboard** - Single issue tracking all dependencies
- ✅ **Interactive rebasing** - Checkbox-based PR updates with conflict resolution
- ✅ **Smart scheduling** - Optimized update frequency based on project analysis
- ✅ **Security focus** - Prioritized security updates with best practices validation
- ✅ **Team integration** - Proper permissions and settings with health checks
- ✅ **Validated configuration** - Pre-tested setup with comprehensive error checking
- ✅ **Project-optimized settings** - Configuration tailored to your specific project type
- ✅ **Recovery capabilities** - Robust error handling and setup resumption support

## 📖 Example Pull Request

Buddy-bot creates professional pull requests that include:

- **Comprehensive update tables** with current and target versions
- **Detailed release notes** extracted from changelogs and GitHub releases
- **Impact analysis** showing breaking changes and migration guides
- **Dynamic labels** for package types, update severity, and ecosystems
- **Automatic reviewers** based on package ownership and team configuration
- **Interactive rebasing** with checkbox-based conflict resolution

![Screenshot](/images/screenshot.png)

## 🔧 Configuration

```typescript
// buddy-bot.config.ts
import type { BuddyBotConfig } from 'buddy-bot'

export default {
  repository: {
    provider: 'github',
    owner: 'your-org',
    name: 'your-repo',
  },
  packages: {
    strategy: 'patch', // 'major' | 'minor' | 'patch' | 'all'
    ignore: ['@types/node'],
    groups: [
      {
        name: 'React Ecosystem',
        packages: ['react', 'react-dom', '@types/react'],
        strategy: 'minor',
      },
    ],
  },
  pullRequest: {
    reviewers: ['team-lead'],
    assignees: ['maintainer'],
    labels: ['dependencies', 'automated'],
    autoMerge: {
      enabled: true,
      strategy: 'squash',
      conditions: ['patch-only'],
    },
  },
  schedule: {
    cron: '0 2 * * 1', // Weekly on Monday at 2 AM
  },
} satisfies BuddyBotConfig
```

## Use Cases

### Enterprise Teams
- **Automated dependency management** across multiple repositories
- **Security-first updates** with priority scheduling
- **Team-based review workflows** with automatic assignments
- **Compliance tracking** with detailed update logs

### Open Source Projects
- **Community-friendly PRs** with detailed explanations
- **Contributor onboarding** through automated maintenance
- **Release coordination** with grouped package updates
- **Documentation integration** with changelog extraction

### CI/CD Pipelines
- **Scheduled automation** with GitHub Actions
- **Multi-strategy updates** (patch, minor, major)
- **Auto-merge capabilities** for trusted updates
- **Rollback detection** with conflict resolution

## Workflow Integration

### GitHub Actions

```yaml
name: Dependency Updates
on:
  schedule:
    - cron: '0 2 * * 1' # Weekly

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bunx buddy-bot update
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Multiple Strategies

```bash
# Daily security patches
buddy-bot update --strategy patch --auto-merge

# Weekly minor updates
buddy-bot update --strategy minor --reviewers team-lead

# Monthly major updates
buddy-bot update --strategy major --assignees senior-dev
```

## 🏗️ Architecture

Buddy-bot is built with modern tools and best practices:

- **⚡ Bun Runtime** - Lightning-fast package management and execution
- **🔍 TypeScript** - Full type safety and IDE integration
- **🧪 Comprehensive Testing** - Unit, integration, and E2E test coverage
- **📦 Modular Design** - Extensible plugin architecture
- **🛡️ Security First** - Secure token handling and permission management

## Comparison

| Feature | Buddy | Dependabot | Renovate |
|---------|-------|------------|----------|
| **Speed** | ⚡ Bun-native | 🐌 Slower | 🐌 Slower |
| **Package Managers** | Bun, npm, yarn, pnpm, pkgx, Launchpad | Limited | Limited |
| **Configuration** | TypeScript, YAML, JSON/JS, package.json | YAML | JSON/JS |
| **Grouping** | ✅ Flexible | ✅ Basic | ✅ Advanced |
| **Zero Config** | ✅ Yes | ✅ Yes | ❌ Complex |
| **Self-hosted** | ✅ Yes | ❌ GitHub only | ✅ Yes |

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/stacksjs/buddy-bot/blob/main/CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/stacksjs/buddy-bot.git
cd buddy-bot

# Install dependencies
bun install

# Run tests
bun test

# Start development
bun dev
```

## Changelog

Please see our [releases](https://github.com/stacksjs/buddy-bot/releases) page for more information on what has changed recently.

## Stargazers

[![Stargazers over time](https://starchart.cc/stacksjs/buddy-bot.svg?variant=adaptive)](https://starchart.cc/stacksjs/buddy-bot)

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/buddy-bot/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

Two things are true: Buddy-bot will always stay open-source, and we do love to receive postcards from wherever it's used! 🌍 _We also publish them on our website._

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094

## Sponsors

We would like to extend our thanks to the following sponsors for funding Buddy-bot development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](https://github.com/stacksjs/buddy-bot/graphs/contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/buddy-bot/tree/main/LICENSE.md) for more information.

Made with 💙

<!-- Badges -->

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/buddy/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/buddy -->
