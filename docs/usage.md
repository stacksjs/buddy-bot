# Get Started

There are multiple ways to use buddy-bot: _as a CLI tool, library, or GitHub Action._

## Quick Start

1. **Install buddy-bot** _(see [Installation](/install))_
2. **Set up GitHub Actions permissions** for PR creation
3. **Create configuration** _(optional)_
4. **Run dependency scan**

```bash
# Quick scan for outdated packages
buddy-bot scan

# Create pull requests for updates
buddy-bot update

# Rebase an existing PR
buddy-bot rebase 123
```

## CLI Usage

### Basic Commands

```bash
# Scan for outdated packages
buddy-bot scan
buddy-bot scan --verbose
buddy-bot scan --strategy patch

# Create update pull requests
buddy-bot update
buddy-bot update --dry-run
buddy-bot update --assignee username

# Rebase/retry a specific PR
buddy-bot rebase 123
buddy-bot rebase 123 --force

# Check if PR has rebase checkbox
buddy-bot check-rebase 123
```

### Package Analysis

```bash
# Check specific package
buddy-bot check cac
buddy-bot check @types/bun

# Get package information
buddy-bot info typescript
buddy-bot versions react
buddy-bot latest vue

# Dependency analysis
buddy-bot deps package-name
buddy-bot compare package-name 1.0.0 2.0.0
buddy-bot search "ui library"
```

### Configuration & Utilities

```bash
# Generate configuration file
buddy-bot init
buddy-bot init --template comprehensive

# Generate GitHub Actions workflows
buddy-bot workflow daily
buddy-bot workflow security

# Utility commands
buddy-bot help
buddy-bot --version
```

## Library Usage

### Basic Integration

```typescript
import { Buddy } from 'buddy-bot'

const buddy = new Buddy({
  repository: {
    provider: 'github',
    owner: 'your-org',
    name: 'your-repo',
  },
  packages: {
    strategy: 'patch',
    ignore: ['@types/node'],
  },
})

// Scan for updates
const updates = await buddy.scanForUpdates()
console.log(`Found ${updates.length} package updates`)

// Create pull requests
const prs = await buddy.createPullRequests()
console.log(`Created ${prs.length} pull requests`)
```

### Advanced Configuration

```typescript
import type { BuddyBotConfig } from 'buddy-bot'
import { Buddy } from 'buddy-bot'

const config: BuddyBotConfig = {
  verbose: true,

  repository: {
    provider: 'github',
    owner: 'acme-corp',
    name: 'web-app',
    baseBranch: 'main',
  },

  packages: {
    strategy: 'all',
    ignore: ['react', 'vue'], // Keep frameworks stable
    pin: {
      typescript: '^5.0.0', // Pin TypeScript to v5
    },
    groups: [
      {
        name: 'React Ecosystem',
        packages: ['react', 'react-dom', '@types/react'],
        strategy: 'minor',
      },
      {
        name: 'Build Tools',
        packages: ['vite', 'rollup', 'esbuild'],
        strategy: 'patch',
      },
    ],
  },

  pullRequest: {
    reviewers: ['team-lead', 'senior-dev'],
    assignees: ['dependabot-reviewer'],
    labels: ['dependencies', 'automated'],
    autoMerge: {
      enabled: true,
      strategy: 'squash',
      conditions: ['patch-only', 'ci-passing'],
    },
  },

  schedule: {
    cron: '0 2 * * 1', // Weekly on Monday at 2 AM
    timezone: 'UTC',
  },
}

const buddy = new Buddy(config)

// Full workflow
await buddy.run()
```

### Error Handling

```typescript
try {
  const buddy = new Buddy(config)
  const updates = await buddy.scanForUpdates()

  if (updates.length === 0) {
    console.log('All packages are up to date!')
    return
  }

  const prs = await buddy.createPullRequests()
  console.log(`Successfully created ${prs.length} PRs`)
}
catch (error) {
  if (error.code === 'GITHUB_TOKEN_MISSING') {
    console.error('GitHub token required for PR creation')
    process.exit(1)
  }

  if (error.code === 'REPO_NOT_FOUND') {
    console.error('Repository not found or access denied')
    process.exit(1)
  }

  throw error
}
```

## GitHub Actions Integration

### Automated Updates

```yaml
name: Dependency Updates
on:
  schedule:
    - cron: '0 2 * * 1' # Weekly on Monday at 2 AM
  workflow_dispatch: # Allow manual trigger

jobs:
  update-dependencies:
    runs-on: ubuntu-latest
    permissions:
      contents: write # Read repository and write changes
      pull-requests: write # Create and update pull requests
      actions: write # Update workflow files (optional)

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Update dependencies
        run: bunx buddy-bot update
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} # Built-in token
```

### Security Updates

```yaml
name: Security Updates
on:
  schedule:
    - cron: '0 */6 * * *' # Every 6 hours

jobs:
  security-updates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - name: Security updates only
        run: |
          bunx buddy-bot update \
            --strategy patch \
            --labels security,dependencies \
            --auto-merge
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Matrix Strategy

```yaml
name: Multi-Strategy Updates
on:
  schedule:
    - cron: '0 2 * * 1'

jobs:
  update:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        strategy: [patch, minor, major]

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - name: Update ${{ matrix.strategy }}
        run: |
          bunx buddy-bot update \
            --strategy ${{ matrix.strategy }} \
            --labels ${{ matrix.strategy }}-updates
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Configuration Files

Buddy-bot automatically detects configuration files:

### TypeScript Configuration

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
    strategy: 'patch',
    ignore: ['@types/node'],
  },
  pullRequest: {
    reviewers: ['team-lead'],
    labels: ['dependencies'],
  },
} satisfies BuddyBotConfig
```

### JSON Configuration

```json
{
  "repository": {
    "provider": "github",
    "owner": "your-org",
    "name": "your-repo"
  },
  "packages": {
    "strategy": "patch",
    "ignore": ["@types/node"]
  },
  "pullRequest": {
    "reviewers": ["team-lead"],
    "labels": ["dependencies"]
  }
}
```

## Environment Variables

```bash
# For GitHub Actions (automatically provided)
GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}

# For local development (if needed)
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Optional: Custom registry
export NPM_REGISTRY_URL=https://registry.npmjs.org

# Optional: Bun configuration
export BUN_CONFIG_NO_CACHE=false

# Optional: Debug mode
export DEBUG=buddy-bot:*
```

## Workflow Examples

### Daily Patch Updates

```bash
#!/bin/bash
# daily-updates.sh

buddy-bot update \
  --strategy patch \
  --auto-merge \
  --labels security,patch-updates
```

### Weekly Comprehensive Updates

```bash
#!/bin/bash
# weekly-updates.sh

buddy-bot update \
  --strategy all \
  --reviewers team-lead,senior-dev \
  --assignees maintainer \
  --labels dependencies,weekly-update
```

### Emergency Security Update

```bash
#!/bin/bash
# security-update.sh

buddy-bot update \
  --strategy patch \
  --packages-only security \
  --auto-merge \
  --labels security,urgent
```

## Monorepo Support

For monorepos with multiple `package.json` files:

```typescript
// buddy-bot.config.ts
export default {
  packages: {
    workspaces: [
      'packages/*',
      'apps/*',
      'tools/*',
    ],
    strategy: 'patch',
    groups: [
      {
        name: 'Frontend Apps',
        packages: ['packages/web', 'packages/mobile'],
        strategy: 'minor',
      },
      {
        name: 'Backend Services',
        packages: ['apps/api', 'apps/worker'],
        strategy: 'patch',
      },
    ],
  },
} satisfies BuddyBotConfig
```

## Testing

```bash
# Test configuration
buddy-bot scan --dry-run --verbose

# Test GitHub authentication
buddy-bot scan --verbose

# Test package detection
buddy-bot check typescript
```

## Performance Tips

- Use `--strategy patch` for faster, safer updates
- Configure package groups for related dependencies
- Use scheduling to avoid peak hours
- Enable auto-merge for patch updates
- Use ignore lists for critical packages

## Troubleshooting

### Common Issues

**No packages found:**
```bash
# Ensure Bun is installed and package.json exists
bun --version
ls package.json
```

**GitHub authentication failed:**
```bash
# For GitHub Actions: Check workflow permissions
# For local development: Check token permissions
gh auth status
```

**PR creation failed:**
```bash
# Verbose mode for detailed error information
buddy-bot update --verbose
```

**Package registry issues:**
```bash
# Clear Bun cache
bun pm cache rm
```

Read more about specific features in the [Features](/features/scanning) section.
