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

## Enhanced Features

The setup wizard provides a comprehensive configuration experience with advanced validation:

### Core Features
- **🔍 Automatic Repository Detection** - Detects GitHub repository from git remote with API validation
- **🔑 Enhanced Token Setup** - Comprehensive PAT guidance with scope validation and testing
- **🔧 Repository Settings Validation** - Real-time GitHub Actions permissions verification
- **⚙️ Intelligent Workflow Presets** - Smart recommendations based on project analysis
- **📝 Project-Aware Configuration** - Optimized settings based on detected project characteristics
- **🔄 Validated Workflow Creation** - YAML validation and security best practices verification
- **🎯 Comprehensive Instructions** - Complete setup verification and troubleshooting guidance

### Advanced Enhancements
- **🛡️ Pre-flight Validation** - Environment checks, conflict detection, and prerequisite validation
- **📊 Smart Project Analysis** - Automatic detection of project type, package manager, and ecosystem
- **📈 Interactive Progress Tracking** - Visual progress indicators with step-by-step guidance
- **🔍 Repository Health Checks** - API-based validation of repository access and permissions
- **⚙️ Workflow Validation** - Real-time YAML syntax and security validation
- **🚀 Recovery Capabilities** - Detailed error reporting and setup resumption support
- **📋 Configuration Migration** - Seamless import from Renovate and Dependabot configurations
- **🔌 Integration Ecosystem** - Extensible plugin system with Slack, Discord, and Jira integrations

## Setup Flow

### Configuration Migration & Discovery
```
🔍 Configuration Migration Detection:
Found 1 existing dependency management tool(s):
   • renovate (renovate.json)

📋 Migrating configurations...
✅ Migrated renovate configuration

📋 Configuration Migration Report

## RENOVATE Migration
- **Config Found**: ✅ Yes
- **Confidence**: 🟢 high
- **Migrated Settings**: schedule, packages, ignore, autoMerge, assignees, reviewers
```

**Migration Features:**
- **Tool Detection** - Automatically discovers Renovate (`renovate.json`, `.renovaterc`, package.json) and Dependabot (`.github/dependabot.yml`) configurations
- **Smart Conversion** - Maps Renovate package rules to Buddy Bot groups, converts schedules to workflow presets, and preserves team assignments
- **Compatibility Analysis** - Identifies unsupported features like `extends` presets and `regexManagers`, provides alternatives and workarounds
- **Migration Report** - Detailed summary with confidence levels, migrated settings, warnings, and incompatible features

**Supported Migrations:**
- **Renovate**: Schedule patterns, package rules, ignore lists, automerge settings, assignees/reviewers
- **Dependabot**: Update intervals, ignore patterns, package ecosystem configurations
- **Confidence Scoring**: High (direct mapping), Medium (partial support), Low (significant incompatibilities)

### Integration Discovery
```
🔌 Integration Discovery:
Found 2 available integration(s):
   • slack-integration v1.0.0
   • discord-integration v1.0.0

🔌 Executing integration hooks...
✅ Executed hook: notify-slack
✅ Executed hook: notify-discord
```

**Plugin Discovery:**
- **Environment Detection** - Scans for `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `JIRA_API_TOKEN` environment variables
- **File-Based Configuration** - Checks `.buddy/slack-webhook`, `.buddy/discord-webhook`, `.buddy/jira-config.json` files
- **Custom Plugins** - Loads plugins from `.buddy/plugins/*.json` directory with error handling
- **Integration Loading** - Automatically enables discovered integrations for setup completion notifications

**Built-in Integrations:**
- **Slack**: Rich setup completion messages with repository details and project information
- **Discord**: Colorful embed notifications with project type and package manager details
- **Jira**: Automatic ticket creation for tracking setup completion with project context

### Pre-flight Validation
```
🔍 Pre-flight Validation
✅ Git repository detected
✅ Bun v1.2.19 detected
⚠️  Found 2 existing workflows. Some may conflict with Buddy Bot workflows.
💡 GitHub CLI detected. This can help with authentication.
```

**Environment Checks:**
- **Git repository validation** - Ensures you're in a git repository with proper remote configuration
- **Runtime environment** - Validates Node.js or Bun installation for optimal performance
- **Git configuration** - Checks for user.name and user.email configuration
- **GitHub CLI detection** - Identifies helpful tools for authentication and setup

**Conflict Detection:**
- **Existing workflows** - Scans `.github/workflows/` for potential conflicts
- **Dependency management tools** - Detects Renovate, Dependabot, or other dependency managers
- **Configuration conflicts** - Identifies existing configuration that might interfere

### Smart Project Analysis
```
🔍 Project Analysis:
📦 Project Type: application
⚙️  Package Manager: bun
🔒 Lock File: Found
📄 Dependency Files: Found
🔄 GitHub Actions: Found
💡 Recommended Preset: Standard Setup

📋 Recommendations:
   • Bun detected. Optimal performance expected.
   • Dependency files detected. Multi-format support enabled.
   • 3 existing workflow(s) found. GitHub Actions updates will be included.
```

**Project Intelligence:**
- **Project type detection** - Identifies library, application, monorepo based on package.json and file structure
- **Package manager analysis** - Detects Bun, npm, yarn, pnpm with lock file validation
- **Dependency ecosystem** - Finds pkgx.yaml, deps.yaml, and Launchpad dependency files
- **GitHub Actions discovery** - Scans existing workflows for update integration
- **Smart recommendations** - Suggests optimal configuration based on detected characteristics

### Interactive Progress Tracking
```
📊 Setup Progress: 75% [███████████████░░░░░]
🔄 Current Step: Workflow Generation (6/8)
✅ Completed: Pre-flight checks, Project analysis, Repository Detection, GitHub Token Setup, Repository Settings
```

**Progress Features:**
- **Visual progress bar** - Real-time completion percentage with graphical indicators
- **Step tracking** - Clear indication of current step and total progress
- **Completion history** - Shows which steps have been successfully completed
- **Time tracking** - Monitors setup duration for performance insights
- **Recovery support** - Maintains progress state for resumption after interruptions

### Step 3: Repository Detection & Validation
```
📍 Step 1: Repository Detection
✅ Detected repository: your-org/your-repo
🔗 GitHub URL: https://github.com/your-org/your-repo
```

Automatically detects your GitHub repository from `git remote get-url origin` and performs comprehensive validation:

**Enhanced Repository Validation:**
- **API connectivity** - Tests GitHub API access and repository permissions
- **Repository health** - Validates issues are enabled, repository is accessible, and permissions are adequate
- **Private repository support** - Enhanced validation for private repositories with appropriate token scopes
- **Organization settings** - Checks for organization-level restrictions that might affect setup

### Step 4: GitHub Token Setup
```
🔑 Step 2: GitHub Token Setup
For full functionality, Buddy Bot needs a Personal Access Token (PAT).
This enables workflow file updates and advanced GitHub Actions features.
```

Provides three options:
- **Create new token** - Full guidance through PAT creation process
- **Have existing token** - Setup for existing PAT
- **Skip for now** - Use limited GITHUB_TOKEN permissions

### Step 5: Repository Settings
```
🔧 Step 3: Repository Settings
```

Guides you through configuring GitHub Actions permissions:
1. Repository settings → Actions → General
2. Select "Read and write permissions"
3. Enable "Allow GitHub Actions to create and approve pull requests"

### Step 6: Workflow Configuration
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

### Step 7: Configuration File Generation
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

### Step 8: Workflow Generation
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

### Workflow Validation & Testing
```
🔍 Validating Generated Workflows
✅ buddy-dashboard.yml validated successfully
✅ buddy-update-check.yml validated successfully
✅ buddy-update.yml validated successfully
```

**Validation Features:**
- **YAML syntax validation** - Ensures all generated workflows are syntactically correct
- **Required field verification** - Validates presence of name, on, jobs, and other essential fields
- **Security best practices** - Checks token usage, permissions, and security configurations
- **Buddy Bot integration** - Verifies workflows include proper buddy-bot execution commands
- **Permission validation** - Ensures workflows have appropriate permissions for their functions

**Security Validation:**
- **Token scope verification** - Validates GITHUB_TOKEN vs BUDDY_BOT_TOKEN usage
- **Permission matrix** - Ensures workflows have minimum required permissions
- **Secret handling** - Validates secure handling of tokens and sensitive information
- **Workflow permissions** - Checks for explicit permission definitions and security boundaries

### Step 9: Final Instructions & Integration Notifications
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

**Integration Notifications:**
- **Slack Messages** - Rich setup completion notifications with repository details, project type, and package manager information
- **Discord Embeds** - Colorful setup completion embeds with project metadata and timestamp tracking
- **Jira Tickets** - Automatic task creation for tracking and documenting setup completion
- **Custom Hooks** - Extensible plugin system for organization-specific notifications and integrations

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
name: Buddy Check

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

## Technical Implementation

### Enhanced Setup Architecture

The enhanced setup command implements several advanced systems for a robust configuration experience:

#### Pre-flight Validation System
```typescript
interface ValidationResult {
  success: boolean
  errors: string[]
  warnings: string[]
  suggestions: string[]
}
```

**Environment Validation:**
- **Git repository checks** - Validates `.git` directory and remote configuration
- **Runtime environment** - Detects and validates Node.js/Bun installation
- **Configuration validation** - Checks git user.name and user.email settings
- **Tool detection** - Identifies GitHub CLI and other helpful development tools

**Conflict Detection:**
- **Workflow scanning** - Analyzes `.github/workflows/` for potential conflicts
- **Tool identification** - Detects Renovate, Dependabot, and other dependency managers
- **Configuration conflicts** - Identifies existing buddy-bot or similar configurations

#### Smart Project Analysis Engine
```typescript
interface ProjectAnalysis {
  type: 'library' | 'application' | 'monorepo' | 'unknown'
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown'
  hasLockFile: boolean
  hasDependencyFiles: boolean
  hasGitHubActions: boolean
  recommendedPreset: string
  recommendations: string[]
}
```

**Project Intelligence:**
- **Type detection algorithm** - Analyzes package.json structure, workspace configuration, and file patterns
- **Package manager detection** - Identifies lock files and package manager signatures
- **Ecosystem analysis** - Scans for pkgx.yaml, deps.yaml, and Launchpad dependency files
- **Workflow integration** - Discovers existing GitHub Actions for update integration

#### Progress Tracking System
```typescript
interface SetupProgress {
  currentStep: number
  totalSteps: number
  stepName: string
  completed: string[]
  failed?: string
  canResume: boolean
  startTime: Date
}
```

**Progress Features:**
- **Visual indicators** - Real-time progress bars with completion percentages
- **State management** - Tracks completed steps and current progress
- **Recovery support** - Maintains state for resumption after interruptions
- **Performance monitoring** - Tracks setup duration and efficiency

#### Repository Validation API
```typescript
async function validateRepositoryAccess(repoInfo: RepositoryInfo): Promise<ValidationResult>
```

**API-Based Validation:**
- **Repository existence** - Tests GitHub API access and repository availability
- **Permission validation** - Verifies read/write access and organizational restrictions
- **Feature availability** - Checks if issues, pull requests, and actions are enabled
- **Private repository support** - Enhanced validation for private repositories

#### Workflow Validation Engine
```typescript
async function validateWorkflowGeneration(workflowContent: string): Promise<ValidationResult>
```

**Comprehensive Validation:**
- **YAML syntax validation** - Ensures generated workflows are syntactically correct
- **Security best practices** - Validates token usage, permissions, and security configurations
- **Buddy Bot integration** - Verifies workflows include proper execution commands
- **Permission matrix validation** - Ensures workflows have appropriate GitHub Actions permissions

### Error Handling & Recovery

**Graceful Error Management:**
- **Detailed error reporting** - Comprehensive error messages with suggested solutions
- **Progressive degradation** - Continues setup where possible when non-critical steps fail
- **Recovery mechanisms** - Allows resumption from failed steps with state preservation
- **Rollback capabilities** - Provides mechanisms to undo partial setup on failure

**User Experience Enhancements:**
- **Clear progress indicators** - Visual feedback on setup progression
- **Contextual help** - Situation-specific guidance and troubleshooting
- **Intelligent recommendations** - Project-specific suggestions based on analysis
- **Setup verification** - Post-setup validation to ensure everything works correctly

## Next Steps

After successful setup:

1. **[Learn about the Dashboard](../features/dependency-dashboard.md)** - Understand dependency management
2. **[Explore Update Strategies](../features/update-strategies.md)** - Configure update behavior
3. **[Configure Package Management](../features/package-management.md)** - Fine-tune package handling
4. **[Review Pull Request Features](../features/pull-requests.md)** - Understand PR automation
