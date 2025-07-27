# Setup Command

Interactive setup wizard for automated dependency management.

## Overview

The `setup` command provides a comprehensive, Renovate-like setup experience that guides you through configuring Buddy Bot for your project. It automates the entire process from repository detection to workflow generation.

```bash
buddy-bot setup [options]
```

## Quick Start

```bash
# Run interactive setup (recommended)
buddy-bot setup

# Setup with verbose logging
buddy-bot setup --verbose
```

## Features

The setup wizard provides a complete configuration experience:

- **🔍 Automatic Repository Detection** - Detects GitHub repository from git remote
- **🔑 Token Setup Guidance** - Walks through Personal Access Token creation
- **🔧 Repository Settings** - Configures GitHub Actions permissions
- **⚙️ Workflow Presets** - Choose from pre-configured update strategies
- **📝 Configuration Generation** - Creates `buddy-bot.config.json` with your settings
- **🔄 Workflow Creation** - Generates three core GitHub Actions workflows
- **🎯 Clear Instructions** - Provides next steps and links to settings

## Setup Flow

### Step 1: Repository Detection
```
📍 Step 1: Repository Detection
✅ Detected repository: your-org/your-repo
🔗 GitHub URL: https://github.com/your-org/your-repo
```

Automatically detects your GitHub repository from `git remote get-url origin` and validates the repository information.

### Step 2: GitHub Token Setup
```
🔑 Step 2: GitHub Token Setup
For full functionality, Buddy Bot needs a Personal Access Token (PAT).
This enables workflow file updates and advanced GitHub Actions features.
```

Provides three options:
- **Create new token** - Full guidance through PAT creation process
- **Have existing token** - Setup for existing PAT
- **Skip for now** - Use limited GITHUB_TOKEN permissions

### Step 3: Repository Settings
```
🔧 Step 3: Repository Settings
```

Guides you through configuring GitHub Actions permissions:
1. Repository settings → Actions → General
2. Select "Read and write permissions"
3. Enable "Allow GitHub Actions to create and approve pull requests"

### Step 4: Workflow Configuration
```
⚙️ Step 4: Workflow Configuration
What type of update schedule would you like?
```

Choose from carefully crafted presets:

#### Available Presets

| Preset | Description | Dashboard | Updates | Auto-merge |
|--------|-------------|-----------|---------|------------|
| **Standard Setup** | Balanced approach for most projects | 3x/week | Mon/Wed/Fri | Patch only |
| **High Frequency** | Multiple checks per day | Daily | Every 6 hours | Patch only |
| **Security Focused** | Security-first approach | Daily | Every 4 hours | Security patches |
| **Minimal Updates** | Low-frequency updates | Weekly | Monday only | Manual |
| **Development/Testing** | Testing and debugging | Manual | Every 15 min | Disabled |
| **Custom Configuration** | Build your own schedule | Custom | Custom | Custom |

### Step 5: Configuration File Generation
```
📝 Step 5: Configuration File
✅ Created buddy-bot.config.json with your repository settings.
💡 You can edit this file to customize Buddy Bot's behavior.
```

Creates a complete configuration file with:
- Repository information
- Dashboard settings
- Workflow templates
- Package strategies
- Default options

### Step 6: Workflow Generation
```
🔄 Step 6: Workflow Generation
✨ Setting up Standard Setup...
📋 Dashboard updates 3x/week, balanced dependency updates
```

Generates three core workflows:

#### 1. Dashboard Workflow (`buddy-dashboard.yml`)
- **Schedule**: Monday, Wednesday, Friday at 9 AM UTC
- **Purpose**: Manages dependency dashboard issue
- **Features**: Manual triggers, dry-run mode, verbose logging

#### 2. Update Check Workflow (`buddy-update-check.yml`)
- **Schedule**: Every 15 minutes
- **Purpose**: Auto-rebase PRs with checked rebase boxes
- **Features**: Automatic PR updates, conflict resolution

#### 3. Update Workflow (`buddy-update.yml`)
- **Schedule**: Based on selected preset
- **Purpose**: Scheduled dependency updates
- **Features**: Manual triggers, strategy selection, package filtering

### Step 7: Final Instructions
```
🎉 Setup Complete!
✅ Generated 3 core workflows in .github/workflows/:
   - buddy-dashboard.yml (Dependency Dashboard Management)
   - buddy-update-check.yml (Auto-rebase PR checker)
   - buddy-update.yml (Scheduled dependency updates)
📁 Configuration file: buddy-bot.config.json
```

Provides clear next steps with:
- Git commands for committing changes
- Token setup instructions (if needed)
- Repository permissions configuration
- Links to GitHub settings pages

## Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose, -v` | Enable verbose logging and detailed output | `false` |

## Generated Files

The setup process creates several files:

### Configuration File (`buddy-bot.config.json`)
```json
{
  "repository": {
    "owner": "your-org",
    "name": "your-repo",
    "provider": "github"
  },
  "dashboard": {
    "enabled": true,
    "pin": false,
    "title": "Dependency Updates Dashboard"
  },
  "workflows": {
    "enabled": true,
    "outputDir": ".github/workflows",
    "templates": {
      "daily": true,
      "weekly": true,
      "monthly": true
    }
  },
  "packages": {
    "strategy": "all",
    "ignore": []
  },
  "verbose": false
}
```

### Workflow Files

#### Dashboard Workflow
```yaml
name: Buddy Dashboard Management

on:
  schedule:
    - cron: '0 9 * * 1,3,5' # Monday, Wednesday, Friday at 9 AM UTC
  workflow_dispatch: # Manual triggering
```

#### Update Check Workflow
```yaml
name: Buddy Update Check

on:
  schedule:
    - cron: '*/15 * * * *' # Check every 15 minutes
  workflow_dispatch: # Manual trigger
```

#### Update Workflow
```yaml
name: Standard Dependency Updates

on:
  schedule:
    - cron: '0 9 * * 1,3,5' # Mon, Wed, Fri
  workflow_dispatch: # Manual trigger with options
```

## Token Setup Guide

### Creating a Personal Access Token

1. **Go to GitHub Settings**
   ```
   https://github.com/settings/tokens
   ```

2. **Generate New Token**
   - Click "Generate new token"
   - Give it a descriptive name (e.g., "buddy-bot-token")

3. **Select Required Scopes**
   - ✅ `repo` - Full control of private repositories
   - ✅ `workflow` - Read and write permissions for GitHub Actions

4. **Copy Token**
   - Copy the generated token immediately
   - You won't be able to see it again

5. **Add Repository Secret**
   ```
   https://github.com/your-org/your-repo/settings/secrets/actions
   ```
   - Click "New repository secret"
   - Name: `BUDDY_BOT_TOKEN`
   - Value: Your generated token
   - Click "Add secret"

### Token Benefits

| Feature | GITHUB_TOKEN | BUDDY_BOT_TOKEN |
|---------|--------------|-----------------|
| **Package Updates** | ✅ Yes | ✅ Yes |
| **PR Creation** | ✅ Yes | ✅ Yes |
| **Workflow Updates** | ❌ No | ✅ Yes |
| **Advanced Features** | ❌ Limited | ✅ Full |

## Repository Settings

Configure GitHub Actions permissions:

1. **Repository Settings**
   ```
   https://github.com/your-org/your-repo/settings/actions
   ```

2. **Workflow Permissions**
   - Select "Read and write permissions"
   - ✅ Check "Allow GitHub Actions to create and approve pull requests"
   - Click "Save"

3. **Organization Settings** (if applicable)
   ```
   https://github.com/organizations/your-org/settings/actions
   ```
   - Configure the same permissions as above
   - Organization settings may override repository settings

## Preset Details

### Standard Setup (Recommended)
- **Dashboard**: Monday, Wednesday, Friday at 9 AM UTC
- **Updates**: Monday, Wednesday, Friday at 9 AM UTC
- **Strategy**: All updates (major, minor, patch)
- **Auto-merge**: Disabled (manual review required)
- **Best for**: Most projects wanting balanced automation

### High Frequency
- **Dashboard**: Daily at 9 AM UTC
- **Updates**: Every 6 hours
- **Strategy**: All updates
- **Auto-merge**: Disabled
- **Best for**: Active projects needing quick updates

### Security Focused
- **Dashboard**: Daily at 9 AM UTC
- **Updates**: Every 4 hours
- **Strategy**: All updates
- **Auto-merge**: Disabled
- **Best for**: Security-critical applications

### Minimal Updates
- **Dashboard**: Weekly on Monday at 9 AM UTC
- **Updates**: Monday only at 9 AM UTC
- **Strategy**: All updates
- **Auto-merge**: Disabled
- **Best for**: Stable projects with low change frequency

### Development/Testing
- **Dashboard**: Manual trigger only
- **Updates**: Every 15 minutes
- **Strategy**: Patch updates only
- **Auto-merge**: Disabled
- **Best for**: Testing Buddy Bot functionality

## Post-Setup

After running setup, follow these steps:

### 1. Review Generated Files
```bash
# Check configuration
cat buddy-bot.config.json

# Review workflows
ls -la .github/workflows/
```

### 2. Test Setup
```bash
# Test repository detection
buddy-bot scan --verbose

# Test dashboard creation
buddy-bot dashboard --dry-run
```

### 3. Commit Changes
```bash
# Add generated files
git add .github/workflows/ buddy-bot.config.json

# Commit setup
git commit -m "Add Buddy Bot dependency management workflows"

# Push to repository
git push
```

### 4. Verify Workflows
1. Go to repository **Actions** tab
2. Verify workflows appear in the list
3. Test manual trigger on dashboard workflow
4. Check workflow permissions if needed

## Troubleshooting

### Setup Issues

**"Not a git repository" error:**
```bash
# Ensure you're in a git repository
git status

# Initialize if needed
git init
git remote add origin https://github.com/your-org/your-repo.git
```

**"Could not detect repository" error:**
```bash
# Check git remote
git remote get-url origin

# Should return: https://github.com/your-org/your-repo.git
# or: git@github.com:your-org/your-repo.git
```

### Permission Issues

**"GitHub Actions is not permitted" error:**
1. Check repository settings → Actions → General
2. Ensure "Read and write permissions" is selected
3. Enable "Allow GitHub Actions to create and approve pull requests"
4. Check organization settings if applicable

**Workflow files not updating:**
1. Ensure `BUDDY_BOT_TOKEN` secret is set
2. Verify token has `workflow` scope
3. Check repository permissions above

### Token Issues

**"Bad credentials" error:**
1. Verify `GITHUB_TOKEN` or `BUDDY_BOT_TOKEN` is set
2. Check token hasn't expired
3. Ensure token has required scopes (`repo`, `workflow`)

## Examples

### Basic Setup
```bash
# Standard interactive setup
buddy-bot setup
```

### Verbose Setup
```bash
# Setup with detailed logging
buddy-bot setup --verbose
```

### Testing Setup Locally
```bash
# Test repository detection
buddy-bot setup --verbose

# If setup completes, test scanning
buddy-bot scan --dry-run
```

## Next Steps

After successful setup:

1. **[Learn about the Dashboard](../features/dependency-dashboard.md)** - Understand dependency management
2. **[Explore Update Strategies](../features/update-strategies.md)** - Configure update behavior
3. **[Configure Package Management](../features/package-management.md)** - Fine-tune package handling
4. **[Review Pull Request Features](../features/pull-requests.md)** - Understand PR automation
