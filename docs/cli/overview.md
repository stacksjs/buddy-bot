# CLI Reference Overview

Buddy provides a comprehensive command-line interface for dependency management, package analysis, and workflow automation.

## Installation & Setup

```bash
# Install Buddy globally
bun add -g buddy-bot

# Interactive setup (recommended first step)
buddy-bot setup

# Or use with bunx (no installation required)
bunx buddy-bot setup
```

**🚀 Start with `setup`** - The setup command provides a complete Renovate-like configuration experience that automatically configures workflows, tokens, and repository settings.

## Command Structure

```bash
buddy-bot <command> [options] [arguments]
```

## Available Commands

### 🚀 Setup & Configuration

| Command | Description |
|---------|-------------|
| [`setup`](/cli/setup) | **Interactive setup wizard** - Complete Renovate-like experience |
| [`open-settings`](/cli/utility#open-settings) | Open GitHub repository and organization settings |

### 🔍 Scanning & Analysis

| Command | Description |
|---------|-------------|
| [`scan`](/cli/update#scan) | Scan for dependency updates |
| [`check`](/cli/package#check) | Check specific packages for updates |

### ⬆️ Updates & Pull Requests

| Command | Description |
|---------|-------------|
| [`update`](/cli/update#update) | Update dependencies and create PRs |
| [`rebase`](/cli/update#rebase) | Rebase/retry a pull request |
| [`update-check`](/cli/update#update-check) | Auto-detect and rebase PRs with checked boxes |

### 📦 Package Information

| Command | Description |
|---------|-------------|
| [`info`](/cli/package#info) | Show detailed package information |
| [`versions`](/cli/package#versions) | Show all available versions of a package |
| [`latest`](/cli/package#latest) | Get the latest version of a package |
| [`exists`](/cli/package#exists) | Check if a package exists in the registry |
| [`deps`](/cli/package#deps) | Show package dependencies |
| [`compare`](/cli/package#compare) | Compare two versions of a package |
| [`search`](/cli/package#search) | Search for packages in the registry |

### ⏰ Automation & Scheduling

| Command | Description |
|---------|-------------|
| [`schedule`](/cli/utility#schedule) | Run automated updates on schedule |

## Global Options

All commands support these global options:

```bash
--verbose, -v    Enable verbose logging
--help, -h       Show help information
--version        Show version information
```

## Examples

### Quick Start

```bash
# Interactive setup (recommended for new projects)
buddy-bot setup

# Scan for available updates
buddy-bot scan --verbose

# Apply updates and create PRs
buddy-bot update
```

### Package Analysis

```bash
# Get information about a package
buddy-bot info react

# Check available versions
buddy-bot versions typescript --latest 5

# Search for packages
buddy-bot search "test framework"
```

### PR Management

```bash
# Rebase a specific PR
buddy-bot rebase 17

# Check all PRs for rebase requests
buddy-bot update-check

# Force rebase even if up to date
buddy-bot rebase 17 --force
```

## Configuration File

Most commands use settings from `buddy-bot.config.ts`:

```typescript
import type { BuddyBotConfig } from 'buddy-bot'

export default {
  verbose: true,
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
    assignees: ['maintainer'],
    labels: ['dependencies'],
  }
} satisfies BuddyBotConfig
```

## Environment Variables

Buddy uses these environment variables:

```bash
# Required for GitHub operations
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Optional: Explicitly set GitHub token
GH_TOKEN=ghp_xxxxxxxxxxxx

# Optional: Configure Bun
BUN_CONFIG_DIR=/path/to/config
```

## Exit Codes

Buddy uses standard exit codes:

- **0**: Success
- **1**: General error (configuration, network, etc.)
- **2**: Command not found or invalid arguments

## Debugging

### Verbose Mode

Enable detailed logging for any command:

```bash
buddy-bot <command> --verbose
```

### Common Issues

**Command not found:**
```bash
# Check installation
which buddy-bot

# Or use bunx
bunx buddy-bot --version
```

**GitHub token issues:**
```bash
# Test token
gh auth status

# Login if needed
gh auth login
```

**Permission errors:**
```bash
# Check repository permissions
buddy-bot open-settings
```

## Integration Examples

### CI/CD Pipeline

```yaml
# .github/workflows/dependencies.yml
- name: Update dependencies
  run: |
    bunx buddy-bot scan --verbose
    bunx buddy-bot update --strategy patch
```

### NPM Scripts

```json
{
  "scripts": {
    "deps:scan": "buddy-bot scan --verbose",
    "deps:update": "buddy-bot update",
    "deps:check": "buddy-bot check react typescript",
    "deps:info": "buddy-bot info"
  }
}
```

### Monorepo Usage

```bash
# Update specific workspace
cd packages/frontend
buddy-bot update --strategy minor

# Check all workspaces
for dir in packages/*/; do
  echo "Checking $dir"
  cd "$dir" && buddy-bot scan
  cd ../..
done
```

## Performance Tips

1. **Use specific strategies**: `--strategy patch` is faster than `all`
2. **Filter packages**: Use `--packages` for targeted updates
3. **Enable caching**: Set `BUN_CONFIG_NO_CACHE=false`
4. **Parallel execution**: Run multiple commands in parallel for monorepos

## Getting Help

### Built-in Help

```bash
# General help
buddy-bot --help

# Command-specific help
buddy-bot scan --help
buddy-bot update --help
```

### Documentation

- **Full Documentation**: [https://buddy.sh/docs](https://buddy.sh/docs)
- **Configuration Guide**: [/config](/config)
- **GitHub Setup**: [/features/github-actions](/features/github-actions)

### Community

- **GitHub Issues**: [Report bugs and feature requests](https://github.com/stacksjs/buddy-bot/issues)
- **Discussions**: [Community discussions](https://github.com/stacksjs/buddy-bot/discussions)
- **Discord**: [Join our Discord](https://discord.gg/stacksjs)
