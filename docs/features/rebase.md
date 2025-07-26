# Rebase Functionality

Buddy Bot's rebase feature allows you to update existing pull requests with the latest dependency versions, ensuring your PRs stay current with the newest available updates.

## Overview

Similar to Renovate's rebase functionality, Buddy Bot monitors pull requests for rebase requests and automatically updates them with fresh dependency scans. This is especially useful when:

- New versions are released after your PR was created
- You want to refresh a stale PR with latest updates
- Dependencies have been updated in the base branch
- You need to retry a failed update

## How It Works

### 1. Rebase Checkbox

Every Buddy Bot pull request includes an interactive checkbox:

```markdown
---
 - [ ] <!-- rebase-check -->If you want to update/retry this PR, check this box
---
```

### 2. Automatic Detection

A GitHub Actions workflow (`.github/workflows/buddy-bot-rebase.yml`) runs every minute and:

1. Scans all open pull requests
2. Identifies Buddy Bot PRs with checked rebase boxes
3. Triggers a fresh dependency scan
4. Updates the PR with latest versions
5. Unchecks the box when complete

### 3. Complete Update Process

During rebase, Buddy Bot:

- **Re-scans dependencies**: Finds the latest available versions
- **Updates all files**: package.json, lock files, dependency files, workflows
- **Refreshes PR content**: Updates title, body, changelog, and metadata
- **Maintains git history**: Uses Git CLI for reliable commits
- **Handles permissions**: Supports both GitHub token and PAT authentication

## Usage

### Interactive Rebase

1. **Open any Buddy Bot PR**
2. **Scroll to the bottom** of the PR description
3. **Check the rebase checkbox**: `- [x] If you want to update/retry this PR, check this box`
4. **Wait for automation**: The workflow will detect and process the request within 1 minute
5. **Review updates**: PR will be refreshed with latest dependency versions

### Manual Rebase via CLI

```bash
# Check for PRs with rebase checkbox enabled
buddy-bot check-rebase

# Preview what would be rebased (dry run)
buddy-bot check-rebase --dry-run

# Run with detailed logging
buddy-bot check-rebase --verbose

# Combine options
buddy-bot check-rebase --dry-run --verbose
```

### Manual Trigger via GitHub Actions

1. Go to **Actions** tab in your repository
2. Select **"Buddy Update Check"** workflow
3. Click **"Run workflow"**
4. Choose options:
   - **Dry run**: Preview changes without applying them
5. Click **"Run workflow"** to execute

## Configuration

### Workflow Setup

The rebase workflow is automatically created when you run `buddy-bot setup`. It includes:

```yaml
name: Buddy Update Check

on:
  schedule:
    - cron: '*/1 * * * *' # Every minute
  workflow_dispatch: # Manual trigger
    inputs:
      dry_run:
        description: Dry run (preview only)
        required: false
        default: false
        type: boolean

permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: write # Required for workflow file updates
```

### Token Configuration

#### Option 1: Personal Access Token (Full Features)

For complete functionality including workflow file updates:

1. **Create PAT**: Go to [GitHub Settings → Tokens](https://github.com/settings/tokens)
2. **Select scopes**:
   - `repo` (Full repository access)
   - `workflow` (Update GitHub Actions workflows)
3. **Add secret**: Repository Settings → Secrets → Add `BUDDY_BOT_TOKEN`
4. **Automatic detection**: Workflow uses PAT when available

#### Option 2: Default GitHub Token (Limited)

Uses the built-in `GITHUB_TOKEN` with these limitations:
- ✅ Updates package.json and dependency files
- ✅ Updates lock files
- ❌ Cannot update workflow files (`.github/workflows/*.yml`)
- ❌ Limited to basic repository operations

### Environment Variables

```bash
# Required for PR operations
GITHUB_TOKEN=<your-token>

# For rebase functionality
BUDDY_BOT_TOKEN=<your-pat> # Optional, fallback to GITHUB_TOKEN
```

## What Gets Updated

### File Types

During rebase, Buddy Bot updates:

| File Type | Examples | Token Required |
|-----------|----------|----------------|
| **Package files** | package.json | GITHUB_TOKEN |
| **Lock files** | package-lock.json, yarn.lock, bun.lockb | GITHUB_TOKEN |
| **Dependency files** | deps.yaml, dependencies.yaml, pkgx.yaml | GITHUB_TOKEN |
| **GitHub Actions** | .github/workflows/*.yml | BUDDY_BOT_TOKEN |

### PR Content

- **Title**: Updated with latest package versions
- **Body**: Refreshed changelog and release notes
- **Tables**: Updated dependency tables with new versions
- **Metadata**: Fresh package statistics and confidence scores
- **Checkbox**: Automatically unchecked after successful rebase

## Troubleshooting

### Common Issues

#### 1. Permission Errors

**Error**: `refusing to allow a GitHub App to create or update workflow`

**Solution**: Add `BUDDY_BOT_TOKEN` with `workflow` scope:
```bash
# 1. Create PAT with 'repo' and 'workflow' scopes
# 2. Add as repository secret 'BUDDY_BOT_TOKEN'
# 3. Re-run the rebase workflow
```

#### 2. Git Identity Errors

**Error**: `Author identity unknown`

**Solution**: The workflow automatically configures Git identity, but you can verify:
```yaml
- name: Configure Git
  run: |
    git config --global user.name "buddy-bot[bot]"
    git config --global user.email "buddy-bot[bot]@users.noreply.github.com"
```

#### 3. No PRs Found

**Error**: `No buddy-bot PRs found`

**Cause**: Workflow looks for PRs created by:
- Branch names starting with `buddy-bot/`
- Author `github-actions[bot]`
- Author containing `buddy`

**Solution**: Ensure PRs were created by Buddy Bot

#### 4. Rebase Not Triggered

**Check**:
1. Checkbox is properly formatted: `- [x] <!-- rebase-check -->`
2. Workflow has proper permissions
3. Actions are enabled in repository settings

## Advanced Usage

### Custom Rebase Logic

You can customize the rebase behavior by modifying the workflow:

```yaml
# Custom rebase frequency
on:
  schedule:
    - cron: '*/5 * * * *' # Every 5 minutes instead of 1

# Custom PR detection
env:
  CUSTOM_AUTHOR_FILTER: 'my-custom-bot'
```

### Integration with Other Tools

The rebase functionality works seamlessly with:

- **Dependency Dashboard**: Checkbox updates reflected in dashboard
- **Auto-merge**: Rebased PRs can be auto-merged if configured
- **Package grouping**: Maintains original grouping during rebase
- **Update strategies**: Respects configured update strategies

### Monitoring Rebase Activity

Track rebase operations via:

- **GitHub Actions logs**: Detailed execution logs
- **PR comments**: Automatic status updates
- **Dashboard updates**: Reflected in dependency dashboard
- **Git history**: Clean commit history maintained

## Best Practices

### When to Use Rebase

- ✅ **Fresh releases**: New versions available since PR creation
- ✅ **Stale PRs**: Long-lived PRs that need refreshing
- ✅ **Failed builds**: Retry after fixing base branch issues
- ✅ **Conflict resolution**: Update with latest base branch changes

### When Not to Use Rebase

- ❌ **Recently created PRs**: Already up-to-date
- ❌ **Active development**: PR being actively reviewed/modified
- ❌ **Complex conflicts**: Manual intervention required
- ❌ **Production hotfixes**: Use direct updates instead

### Performance Considerations

- **Frequency**: Every minute is optimal for responsiveness
- **Rate limits**: GitHub API rate limits apply
- **Resource usage**: Minimal overhead per execution
- **Parallel execution**: Multiple rebase requests handled sequentially
