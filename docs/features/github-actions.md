# GitHub Actions Integration

Buddy provides comprehensive GitHub Actions integration with pre-built workflow templates for automated dependency management.

## Quick Setup

The fastest way to get started is using the interactive setup:

```bash
# Interactive setup with workflow generation
buddy-bot setup
```

This will guide you through:
1. Choosing a workflow preset (Standard, High Frequency, Security Focused, etc.)
2. Generating appropriate workflow files
3. Configuring repository settings

## Workflow Presets

### Standard Project (Recommended)

Daily patch updates, weekly minor updates, monthly major updates:

```yaml
name: Buddy Dependency Updates

on:
  schedule:
    # Patch updates daily at 2 AM
    - cron: '0 2 * * *'
    # Minor updates twice weekly (Monday, Thursday)
    - cron: '0 2 * * 1,4'
    # Major updates monthly (first of month)
    - cron: '0 2 1 * *'
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Update dependencies
        run: bunx buddy-bot update --verbose
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### High Frequency Updates

Check for updates 4 times per day (6AM, 12PM, 6PM, 12AM):

```yaml
on:
  schedule:
    - cron: '0 6,12,18,0 * * *' # Every 6 hours
```

### Security Focused

Frequent patch updates with security-first approach:

```yaml
on:
  schedule:
    - cron: '0 */4 * * *' # Every 4 hours for patches
    - cron: '0 2 * * 1' # Weekly for minor/major
```

### Minimal Updates

Weekly patch updates, monthly minor/major updates:

```yaml
on:
  schedule:
    - cron: '0 2 * * 1' # Weekly patches
    - cron: '0 2 1 * *' # Monthly minor/major
```

## Required Permissions

### Repository Settings

GitHub Actions needs permission to create pull requests:

1. **Repository Settings** → **Actions** → **General**
2. Enable "Allow GitHub Actions to create and approve pull requests"

Quick access:
```bash
buddy-bot open-settings
```

### Workflow Permissions

```yaml
permissions:
  contents: write # Create branches and commits
  pull-requests: write # Create and update PRs
  issues: write # Assign users and add labels
  actions: read # Read workflow status
  checks: read # Read check status
  statuses: read # Read commit statuses
```

### GitHub Token

The `GITHUB_TOKEN` is automatically available in workflows:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

For organization-level workflows, you may need a personal access token:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.PAT_TOKEN }}
```

## Workflow Templates

### Comprehensive Workflow

Multi-strategy workflow with intelligent scheduling:

```yaml
name: Buddy Comprehensive Updates

on:
  schedule:
    - cron: '0 2 * * *' # Daily patches
    - cron: '0 2 * * 1,4' # Bi-weekly minor
    - cron: '0 2 1 * *' # Monthly major
  workflow_dispatch:
    inputs:
      strategy:
        description: Update strategy
        type: choice
        options: [all, major, minor, patch]
        default: all
      dry_run:
        description: Dry run mode
        type: boolean
        default: false

jobs:
  determine-strategy:
    runs-on: ubuntu-latest
    outputs:
      strategy: ${{ steps.strategy.outputs.strategy }}
      auto_merge: ${{ steps.strategy.outputs.auto_merge }}
    steps:
      - name: Determine strategy
        id: strategy
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "strategy=${{ github.event.inputs.strategy }}" >> $GITHUB_OUTPUT
            echo "auto_merge=false" >> $GITHUB_OUTPUT
          elif [ "${{ github.event.schedule }}" = "0 2 * * *" ]; then
            echo "strategy=patch" >> $GITHUB_OUTPUT
            echo "auto_merge=true" >> $GITHUB_OUTPUT
          elif [ "${{ github.event.schedule }}" = "0 2 * * 1,4" ]; then
            echo "strategy=minor" >> $GITHUB_OUTPUT
            echo "auto_merge=false" >> $GITHUB_OUTPUT
          else
            echo "strategy=major" >> $GITHUB_OUTPUT
            echo "auto_merge=false" >> $GITHUB_OUTPUT
          fi

  update:
    needs: determine-strategy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Update dependencies
        run: |
          STRATEGY="${{ needs.determine-strategy.outputs.strategy }}"
          if [ "${{ github.event.inputs.dry_run }}" = "true" ]; then
            bunx buddy-bot update --strategy "$STRATEGY" --dry-run --verbose
          else
            bunx buddy-bot update --strategy "$STRATEGY" --verbose
          fi
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Docker Workflow

For projects using Docker containers:

```yaml
name: Buddy Docker Updates

on:
  schedule:
    - cron: '0 2 * * 1' # Weekly
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    container:
      image: oven/bun:latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: bun install

      - name: Update dependencies
        run: bunx buddy-bot update --verbose
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Monorepo Workflow

For monorepos with multiple packages:

```yaml
name: Buddy Monorepo Updates

on:
  schedule:
    - cron: '0 2 * * 1'
  workflow_dispatch:
    inputs:
      workspace:
        description: Specific workspace to update
        required: false

jobs:
  find-workspaces:
    runs-on: ubuntu-latest
    outputs:
      workspaces: ${{ steps.workspaces.outputs.workspaces }}
    steps:
      - uses: actions/checkout@v4
      - name: Find workspaces
        id: workspaces
        run: |
          if [ "${{ github.event.inputs.workspace }}" != "" ]; then
            echo "workspaces=[\"${{ github.event.inputs.workspace }}\"]" >> $GITHUB_OUTPUT
          else
            WORKSPACES=$(find . -name "package.json" -not -path "./node_modules/*" | sed 's|/package.json||' | sed 's|^./||' | jq -R . | jq -s .)
            echo "workspaces=$WORKSPACES" >> $GITHUB_OUTPUT
          fi

  update-workspace:
    needs: find-workspaces
    runs-on: ubuntu-latest
    strategy:
      matrix:
        workspace: ${{ fromJson(needs.find-workspaces.outputs.workspaces) }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Update workspace
        run: |
          cd ${{ matrix.workspace }}
          bunx buddy-bot update --verbose
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Configuration Integration

### Workflow-Specific Configuration

```typescript
// buddy-bot.config.ts
export default {
  repository: {
    provider: 'github',
    owner: process.env.GITHUB_REPOSITORY_OWNER!,
    name: process.env.GITHUB_REPOSITORY!.split('/')[1],
  },
  packages: {
    strategy: process.env.UPDATE_STRATEGY as any || 'patch',
  },
  pullRequest: {
    reviewers: ['team-lead'],
    assignees: ['maintainer'],
    labels: ['dependencies', 'automated'],
    autoMerge: {
      enabled: process.env.AUTO_MERGE === 'true',
      strategy: 'squash',
      conditions: ['patch-only', 'ci-passing']
    }
  }
}
```

### Environment Variables

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  UPDATE_STRATEGY: patch
  AUTO_MERGE: true
  NODE_ENV: production
```

## Advanced Features

### Auto-Merge Integration

```yaml
- name: Enable auto-merge for patch updates
  if: ${{ needs.determine-strategy.outputs.auto_merge == 'true' }}
  run: |
    echo "🤖 Auto-merge enabled for patch updates"
    # Future: implement auto-merge logic
```

### Notification Integration

```yaml
- name: Notify on completion
  if: always()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    fields: repo,message,commit,author
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### Matrix Strategy

```yaml
strategy:
  matrix:
    strategy: [patch, minor]
    include:
      - strategy: patch
        schedule: daily
      - strategy: minor
        schedule: weekly
```

## Troubleshooting

### Common Issues

**Permission denied errors:**
```bash
Error: GitHub Actions is not permitted to create or approve pull requests
```
**Solution**: Enable "Allow GitHub Actions to create and approve pull requests" in repository settings.

**Token authentication failed:**
```bash
Error: authentication failed
```
**Solution**: Verify GITHUB_TOKEN permissions or use a personal access token.

**Workflow not triggering:**
- Check cron syntax with [crontab.guru](https://crontab.guru)
- Verify repository has commits in default branch
- Check workflow file syntax

### Debugging Workflows

Enable debug logging:

```yaml
env:
  ACTIONS_RUNNER_DEBUG: true
  ACTIONS_STEP_DEBUG: true
```

Add debugging steps:

```yaml
- name: Debug environment
  run: |
    echo "Event: ${{ github.event_name }}"
    echo "Schedule: ${{ github.event.schedule }}"
    echo "Repository: ${{ github.repository }}"
    echo "Actor: ${{ github.actor }}"
```

## Best Practices

### Scheduling

1. **Avoid Peak Hours**: Schedule during low-traffic times (2-6 AM)
2. **Stagger Workflows**: Don't run all workflows simultaneously
3. **Consider Timezones**: Use UTC times consistently
4. **Limit Frequency**: Balance freshness with noise

### Security

1. **Minimal Permissions**: Only grant necessary permissions
2. **Review Dependencies**: Monitor PR content before merging
3. **Protected Branches**: Require reviews for major updates
4. **Audit Logs**: Monitor Actions usage and permissions

### Performance

1. **Concurrent Limits**: GitHub limits concurrent workflow runs
2. **Cache Dependencies**: Use `actions/cache` for large installations
3. **Conditional Execution**: Skip unnecessary steps
4. **Resource Management**: Choose appropriate runner sizes

### Maintenance

1. **Regular Updates**: Keep workflow Actions updated
2. **Monitor Failures**: Set up alerts for workflow failures
3. **Review Logs**: Periodically check workflow execution logs
4. **Clean Up**: Remove unused workflows and secrets
