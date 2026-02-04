# Getting Started

Buddy Bot is the fastest, most intelligent dependency management bot for modern JavaScript and TypeScript projects. This guide will help you set up automated dependency updates.

## Installation

Install Buddy Bot globally:

::: code-group

```bash [bun]
bun add -g buddy-bot
```

```bash [npm]
npm install -g buddy-bot
```

:::

## Quick Start

### Interactive Setup (Recommended)

The easiest way to get started:

```bash
buddy-bot setup
```

This wizard will guide you through:
- Detecting your project type and package manager
- Migrating from Renovate or Dependabot (if applicable)
- Setting up GitHub Actions workflows
- Configuring update schedules

### Non-Interactive Setup

For CI/CD pipelines:

```bash
# Basic setup with defaults
buddy-bot setup --non-interactive

# With specific preset
buddy-bot setup --non-interactive --preset security --verbose
```

**Available presets:**
- `standard` - Balanced updates (default)
- `high-frequency` - Multiple daily checks
- `security` - Prioritize security patches
- `minimal` - Weekly checks
- `testing` - For development/testing

## Basic Usage

### Scan for Updates

Check for outdated dependencies:

```bash
# Basic scan
buddy-bot scan

# Verbose output
buddy-bot scan --verbose

# Specific packages
buddy-bot scan --packages "react,typescript,@types/node"

# Pattern matching
buddy-bot scan --pattern "@types/*"
```

### Update Dependencies

Create pull requests for updates:

```bash
# Dry run first
buddy-bot update --dry-run

# Apply updates
buddy-bot update

# Specific strategy
buddy-bot update --strategy minor
```

### Check for Rebase Requests

Process PR update requests:

```bash
buddy-bot update-check
buddy-bot update-check --verbose
```

## Update Strategies

| Strategy | Description |
|----------|-------------|
| `all` | All updates regardless of semver impact |
| `major` | Only major version updates |
| `minor` | Major and minor updates (no patch-only) |
| `patch` | All updates (most conservative) |

## Supported Ecosystems

Buddy Bot automatically detects and updates:

### Package Managers
- **Bun** (`bun.lockb`)
- **npm** (`package-lock.json`)
- **yarn** (`yarn.lock`)
- **pnpm** (`pnpm-lock.yaml`)
- **Composer** (`composer.json`, `composer.lock`)
- **Zig** (`build.zig.zon`)

### Dependency Files
- `package.json`
- `deps.yaml` / `dependencies.yaml`
- `pkgx.yaml`
- `.deps.yaml`

### GitHub Actions
- `.github/workflows/*.yml`

## Generated Workflows

After setup, Buddy Bot creates three workflows:

### `buddy-dashboard.yml`
Maintains the dependency dashboard issue:
- Runs Monday, Wednesday, Friday at 9 AM UTC
- Shows all open PRs and detected dependencies
- Interactive checkbox controls

### `buddy-check.yml`
Handles PR rebase requests:
- Runs every minute
- Detects checked rebase boxes
- Updates PR content automatically

### `buddy-update.yml`
Creates dependency update PRs:
- Schedule varies by preset
- Supports manual triggers
- Configurable update strategy

## CLI Reference

```bash
# Setup
buddy-bot setup                    # Interactive setup
buddy-bot setup --non-interactive  # CI/CD mode

# Scanning
buddy-bot scan                     # Scan for updates
buddy-bot scan --verbose           # Detailed output
buddy-bot scan --strategy minor    # Specific strategy

# Updating
buddy-bot update                   # Create update PRs
buddy-bot update --dry-run         # Preview changes

# Maintenance
buddy-bot update-check             # Process rebase requests
buddy-bot dashboard                # Update dashboard issue

# Help
buddy-bot help
buddy-bot --version
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub API token (required for PRs) |
| `BUDDY_BOT_TOKEN` | PAT for workflow file updates |

## Next Steps

- Learn about [Configuration](/guide/configuration) options
- Explore [PR Generation](/guide/pr-generation) customization
- See [Usage Examples](/usage) for advanced patterns
