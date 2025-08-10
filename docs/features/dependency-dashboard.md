# Dependency Dashboard

The dependency dashboard provides a comprehensive overview of your repository's dependencies and open pull requests in a single GitHub issue. Similar to Renovate's dependency dashboard, it offers a centralized view for managing dependency updates.

## Features

- **Single Source of Truth**: View all dependencies and open PRs in one place
- **Interactive Controls**: Force retry/rebase PRs by checking boxes
- **Automatic Updates**: Dashboard refreshes automatically when dependencies change
- **Categorized Dependencies**: Organized by package.json, GitHub Actions, and other dependency files
- **Pinnable Issue**: Option to pin the dashboard for easy access
- **Customizable Content**: Configure what sections to display

## Quick Start

### Basic Usage

Create or update your dependency dashboard:

```bash
buddy-bot dashboard
```

### With Options

```bash
# Use custom title
buddy-bot dashboard --title "My Project Dependencies"

# Update specific issue
buddy-bot dashboard --issue-number 42
```

## Configuration

Configure the dashboard in your `buddy-bot.config.ts`:

```typescript
export default {
  repository: {
    provider: 'github',
    owner: 'your-org',
    name: 'your-repo',
    token: process.env.GITHUB_TOKEN,
  },
  dashboard: {
    enabled: true,
    title: 'Dependency Dashboard',
    pin: true,
    labels: ['dependencies', 'dashboard'],
    assignees: ['team-lead'],
    showOpenPRs: true,
    showDetectedDependencies: true,
    includePackageJson: true,
    includeDependencyFiles: true,
    includeGitHubActions: true,
  },
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable dependency dashboard |
| `title` | `string` | `'Dependency Dashboard'` | Custom dashboard title |
| `labels` | `string[]` | `['dependencies', 'dashboard']` | Labels to add to the issue |
| `assignees` | `string[]` | `[]` | Users to assign to the issue |
| `showOpenPRs` | `boolean` | `true` | Show open pull requests section |
| `showDetectedDependencies` | `boolean` | `true` | Show detected dependencies section |
| `includePackageJson` | `boolean` | `true` | Include package.json dependencies |
| `includeDependencyFiles` | `boolean` | `true` | Include deps.yaml and similar files |
| `includeGitHubActions` | `boolean` | `true` | Include GitHub Actions dependencies |
| `issueNumber` | `number` | - | Specific issue number to update |
| `bodyTemplate` | `string` | - | Custom body template |

## Dashboard Sections

### Open Pull Requests

Lists all open dependency-related pull requests with:
- Interactive checkboxes for force retry/rebase
- Package names being updated
- Direct links to PRs

Example:
```markdown
## Open

The following updates have all been created. To force a retry/rebase of any, click on a checkbox below.

 - [ ] <!-- rebase-branch=buddy-bot/update-react-18 -->[chore(deps): update dependency react to v18](../pull/123) (`react`)
```

### Detected Dependencies

Categorized view of all detected dependencies:

#### npm Dependencies
- Dependencies from `package.json` files
- Grouped by dependency type (dependencies, devDependencies, etc.)
- Shows current versions

#### GitHub Actions
- Actions from `.github/workflows/` files
- Displays action names and versions
- Organized by workflow file

#### Dependency Files
- Dependencies from `deps.yaml`, `dependencies.yaml`, etc.
- Package manager agnostic dependencies
- Custom dependency file formats

## Interactive Features

### Force Retry/Rebase

Check the box next to any PR to trigger a retry/rebase:

```markdown
 - [x] <!-- rebase-branch=buddy-bot/update-react-18 -->[chore(deps): update dependency react to v18](../pull/123)
```

This will:
1. Close the existing PR
2. Create a new branch with latest updates
3. Open a fresh PR with current versions

### Manual Trigger

Use the manual trigger at the bottom to force a full repository scan:

```markdown
- [x] <!-- manual job -->Check this box to trigger a request for Buddy Bot to run again on this repository
```

## Automation

### Workflow Integration

Add dashboard updates to your workflow:

```yaml
name: Dependency Dashboard
on:
  schedule:
    - cron: '0 9 * * 1,3,5' # Monday, Wednesday, Friday at 9 AM UTC

jobs:
  update-dashboard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - name: Update Dashboard
        run: bunx buddy-bot dashboard
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**💡 Ready-to-use workflow**: Buddy Bot includes a pre-built dashboard workflow at `.github/workflows/buddy-dashboard.yml` that you can use directly. It includes manual triggering, dry-run mode, and customizable options.

### Auto-Update

The dashboard automatically updates when:
- New dependency PRs are created
- Existing PRs are merged or closed
- Dependencies are added/removed from files
- Manual trigger is checked

## Custom Templates

Create custom dashboard content with templates:

```typescript
export default {
  dashboard: {
    bodyTemplate: `
# {{repository.owner}}/{{repository.name}} Dependencies

Last updated: {{lastUpdated}}

## Summary
- Open PRs: {{openPRs.count}}
- Package.json files: {{detectedDependencies.packageJson.count}}
- GitHub Actions: {{detectedDependencies.githubActions.count}}

[Custom content here]
    `,
  },
}
```

### Template Variables

| Variable | Description |
|----------|-------------|
| `{{repository.owner}}` | Repository owner |
| `{{repository.name}}` | Repository name |
| `{{openPRs.count}}` | Number of open PRs |
| `{{lastUpdated}}` | Last update timestamp |
| `{{detectedDependencies.packageJson.count}}` | Package.json files count |
| `{{detectedDependencies.githubActions.count}}` | GitHub Actions files count |
| `{{detectedDependencies.dependencyFiles.count}}` | Other dependency files count |

### Regular Updates
Set up automated dashboard updates in your CI/CD:

```bash
# In your GitHub Actions workflow
- run: buddy-bot dashboard
```

### Team Assignment
Assign the dashboard to team members for visibility:

```typescript
dashboard: {
  assignees: ['team-lead', 'devops-engineer'],
}
```

### Clear Labels
Use descriptive labels for easy filtering:

```typescript
dashboard: {
  labels: ['dependencies', 'dashboard', 'maintenance'],
}
```

## Troubleshooting

### Dashboard Not Creating

**Issue**: Dashboard command fails with permission errors.

**Solution**: Ensure GitHub token has required permissions:
- `repo` scope for private repositories
- `public_repo` scope for public repositories
- `issues:write` permission

### Dashboard Not Updating

**Issue**: Dashboard shows outdated information.

**Solution**:
1. Check if the issue exists and is open
2. Verify repository configuration
3. Run with `--verbose` for detailed logs

### Missing Dependencies

**Issue**: Some dependencies don't appear in the dashboard.

**Solution**:
1. Verify file paths are correct
2. Check if files match supported formats
3. Enable verbose logging to see parsing details

### Pinning Fails

**Issue**: Dashboard is created but not pinned.

**Solution**:
- Issue pinning requires newer GitHub API features
- Pinning is not critical and failures are gracefully handled
- Pin manually in GitHub UI if needed

## Examples

### Basic Dashboard

```typescript
// buddy-bot.config.ts
export default {
  repository: {
    provider: 'github',
    owner: 'my-org',
    name: 'my-app',
  },
  dashboard: {
    enabled: true,
  },
}
```

### Advanced Configuration

```typescript
// buddy-bot.config.ts
export default {
  dashboard: {
    enabled: true,
    title: 'My App Dependencies',
    pin: true,
    labels: ['dependencies', 'maintenance', 'automated'],
    assignees: ['tech-lead'],
    showOpenPRs: true,
    showDetectedDependencies: true,
    includePackageJson: true,
    includeDependencyFiles: true,
    includeGitHubActions: true,
  },
}
```

### Minimal Dashboard

```typescript
// buddy-bot.config.ts
export default {
  dashboard: {
    enabled: true,
    showOpenPRs: true,
    showDetectedDependencies: false,
    title: 'Open Dependency PRs',
  },
}
```

## Related Features

- [Pull Requests](./pull-requests.md) - Learn about automated PR creation
- [GitHub Actions](./github-actions.md) - GitHub Actions dependency management
- [Configuration](../config.md) - Complete configuration reference
- [CLI Overview](../cli/overview.md) - Command-line interface guide
