# Migrating from Dependabot

This guide provides detailed instructions for migrating from GitHub's Dependabot to Buddy Bot, including configuration conversion and enhanced features.

## Automated Migration

Buddy Bot can automatically detect and migrate Dependabot configurations:

```bash
buddy-bot setup
```

The migration process will:
- 🔍 Detect `.github/dependabot.yml` or `.github/dependabot.yaml`
- ⚙️ Convert basic settings to Buddy Bot format
- ⚠️ Identify configuration gaps (Dependabot is limited)
- 📋 Suggest enhancements and optimizations

## Configuration Mapping

### Basic Settings

| Dependabot Setting | Buddy Bot Equivalent | Notes |
|-------------------|---------------------|-------|
| `package-ecosystem` | Detected automatically | npm, composer, github-actions |
| `directory` | `packages.paths` | File path configuration |
| `schedule.interval` | `schedule.cron` | Converted to cron expressions |
| `schedule.time` | `schedule.cron` | Time included in cron |
| `schedule.timezone` | `schedule.timezone` | Direct mapping |
| `ignore` | `packages.ignore` | Dependency ignore list |
| `assignees` | `pullRequest.assignees` | PR assignee list |
| `reviewers` | `pullRequest.reviewers` | PR reviewer list |
| `labels` | `pullRequest.labels` | PR label list |

### Schedule Conversion

**Dependabot Intervals → Cron:**

| Dependabot | Buddy Bot Cron | Description |
|------------|---------------|-------------|
| `daily` | `0 2 * * *` | Daily at 2 AM |
| `weekly` | `0 2 * * 1` | Monday at 2 AM |
| `monthly` | `0 2 1 * *` | 1st of month at 2 AM |

**With Time and Timezone:**

```yaml
# Dependabot
schedule:
  interval: "weekly"
  day: "monday"
  time: "04:00"
  timezone: "America/New_York"
```

```typescript
// Buddy Bot
{
  schedule: {
    cron: '0 4 * * 1', // Monday 4 AM
    timezone: 'America/New_York'
  }
}
```

## Migration Examples

### Simple npm Configuration

**Before (Dependabot):**
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    ignore:
      - dependency-name: "react"
      - dependency-name: "typescript"
```

**After (Buddy Bot):**
```typescript
export default {
  schedule: {
    cron: '0 2 * * 1', // Weekly Monday 2 AM
    timezone: 'UTC'
  },
  packages: {
    strategy: 'all',
    ignore: ['react', 'typescript']
  }
} satisfies BuddyBotConfig
```

### Multi-Ecosystem Configuration

**Before (Dependabot):**
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
    assignees:
      - "frontend-team"
    labels:
      - "npm"
      - "dependencies"

  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "weekly"
    assignees:
      - "backend-team"
    labels:
      - "composer"
      - "dependencies"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
    assignees:
      - "devops-team"
    labels:
      - "github-actions"
      - "dependencies"
```

**After (Buddy Bot):**
```typescript
export default {
  schedule: {
    cron: '0 2 * * *', // Daily base schedule
    timezone: 'UTC'
  },
  packages: {
    strategy: 'all',
    groups: [
      {
        name: 'npm packages',
        patterns: ['*'],
        files: ['package.json'],
        updateType: 'all',
        assignees: ['frontend-team'],
        labels: ['npm', 'dependencies']
      },
      {
        name: 'Composer packages',
        patterns: ['*'],
        files: ['composer.json'],
        updateType: 'all',
        schedule: {
          cron: '0 2 * * 1' // Weekly override
        },
        assignees: ['backend-team'],
        labels: ['composer', 'dependencies']
      },
      {
        name: 'GitHub Actions',
        patterns: ['*'],
        files: ['.github/workflows/*.yml'],
        updateType: 'all',
        schedule: {
          cron: '0 2 1 * *' // Monthly override
        },
        assignees: ['devops-team'],
        labels: ['github-actions', 'dependencies']
      }
    ]
  }
} satisfies BuddyBotConfig
```

### Advanced Configuration with Ignores

**Before (Dependabot):**
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
      time: "06:00"
      timezone: "Europe/London"
    ignore:
      - dependency-name: "react"
        versions: [">=17.0.0"]
      - dependency-name: "@types/*"
      - dependency-name: "eslint"
        update-types: ["version-update:semver-major"]
    assignees:
      - "maintainer"
    reviewers:
      - "security-team"
    labels:
      - "dependencies"
      - "automerge"
```

**After (Buddy Bot):**
```typescript
export default {
  schedule: {
    cron: '0 6 * * *', // Daily 6 AM
    timezone: 'Europe/London'
  },
  packages: {
    strategy: 'minor', // Excludes major updates globally
    ignore: [
      'react', // Ignore react entirely
      '@types/*', // Ignore all @types packages
    ],
    groups: [
      {
        name: 'ESLint Updates',
        packages: ['eslint'],
        updateType: 'minor', // Only minor/patch for eslint
        autoMerge: false
      },
      {
        name: 'Auto-merge Updates',
        patterns: ['*'],
        updateType: 'patch',
        autoMerge: true,
        labels: ['dependencies', 'automerge']
      }
    ]
  },
  pullRequest: {
    assignees: ['maintainer'],
    reviewers: ['security-team'],
    labels: ['dependencies']
  }
} satisfies BuddyBotConfig
```

## Enhanced Features

Buddy Bot provides several features not available in Dependabot:

### Dependency Dashboard

```typescript
export default {
  dashboard: {
    enabled: true,
    title: 'Dependency Dashboard',
    pin: true,
    includePackageJson: true,
    includeGitHubActions: true,
    labels: ['dependencies', 'dashboard']
  }
} satisfies BuddyBotConfig
```

### Smart Grouping

```typescript
export default {
  packages: {
    groups: [
      {
        name: 'React Ecosystem',
        patterns: ['react', 'react-*', '@types/react*'],
        updateType: 'minor'
      },
      {
        name: 'TypeScript Definitions',
        patterns: ['^@types/'],
        updateType: 'all',
        autoMerge: true
      },
      {
        name: 'Development Tools',
        patterns: ['eslint*', 'prettier', '@typescript-eslint/*'],
        updateType: 'minor',
        schedule: {
          cron: '0 2 * * 1' // Weekly for dev tools
        }
      }
    ]
  }
} satisfies BuddyBotConfig
```

### Auto-merge Configuration

```typescript
export default {
  pullRequest: {
    autoMerge: {
      enabled: true,
      strategy: 'squash',
      conditions: [
        'status-success',
        'no-conflicts',
        'approved-by-reviewers'
      ]
    }
  },
  packages: {
    groups: [
      {
        name: 'Safe Updates',
        patterns: ['*'],
        updateType: 'patch',
        autoMerge: true
      },
      {
        name: 'Manual Review',
        patterns: ['*'],
        updateType: 'major',
        autoMerge: false
      }
    ]
  }
} satisfies BuddyBotConfig
```

## Migration Process

### 1. Backup Dependabot Configuration

```bash
cp .github/dependabot.yml .github/dependabot.yml.backup
```

### 2. Disable Dependabot

Add this to your Dependabot config to disable it temporarily:

```yaml
version: 2
updates: []
# Temporarily disabled for Buddy Bot migration
```

### 3. Run Buddy Bot Setup

```bash
buddy-bot setup
```

### 4. Test Configuration

```bash
# Scan for updates
buddy-bot scan --verbose

# Test update process
buddy-bot update --dry-run

# Create dashboard
buddy-bot dashboard
```

### 5. Validate Workflows

Check generated GitHub Actions:
- `.github/workflows/buddy-dashboard.yml`
- `.github/workflows/buddy-check.yml`
- `.github/workflows/buddy-update.yml`

### 6. Monitor and Adjust

1. **Week 1**: Monitor PR creation and quality
2. **Week 2**: Fine-tune grouping and scheduling
3. **Week 3**: Enable auto-merge for trusted updates
4. **Week 4**: Remove Dependabot configuration

## Comparison: Dependabot vs Buddy Bot

| Feature | Dependabot | Buddy Bot |
|---------|------------|-----------|
| **Package Managers** | 10+ ecosystems | npm, Composer, GitHub Actions |
| **Scheduling** | Basic intervals | Full cron expressions |
| **Grouping** | Limited | Advanced pattern matching |
| **Auto-merge** | Basic | Conditional with rules |
| **Dashboard** | ❌ No | ✅ Rich dependency dashboard |
| **PR Rebasing** | ❌ Manual | ✅ Automated rebase detection |
| **Workflow Integration** | ❌ Limited | ✅ Full GitHub Actions |
| **Monorepo Support** | ⚠️ Basic | ✅ Advanced |
| **Custom Scheduling** | ❌ No | ✅ Per-group scheduling |

## Advantages of Migration

### ✅ Better Features
- **Rich Dashboard**: Visual dependency overview
- **Smart Grouping**: Advanced pattern-based grouping
- **Flexible Scheduling**: Full cron expression support
- **Auto-rebase**: Automatic PR updates
- **Workflow Integration**: Native GitHub Actions

### ✅ Better Control
- **Granular Configuration**: Per-group settings
- **Conditional Auto-merge**: Rule-based merging
- **Custom Templates**: PR title/body customization
- **Advanced Filtering**: Complex ignore patterns

### ✅ Better Visibility
- **Centralized Dashboard**: All dependencies in one place
- **Update Analytics**: Track update patterns
- **PR Management**: Enhanced PR lifecycle
- **Status Tracking**: Real-time update status

## Troubleshooting

### Common Issues

**Limited ecosystem support:**
```
Buddy Bot focuses on the most common package managers.
For other ecosystems, consider keeping Dependabot for those specific paths.
```

**Complex ignore patterns:**
```yaml
# Dependabot supports complex ignore patterns
# Simplify to basic package names in Buddy Bot
```

**Version-specific ignores:**
```
Buddy Bot uses package-level ignores rather than version-specific.
Use pinning for version-specific control.
```

### Hybrid Approach

You can run both tools for different ecosystems:

```yaml
# .github/dependabot.yml (for unsupported ecosystems)
version: 2
updates:
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "terraform"
    directory: "/infrastructure"
    schedule:
      interval: "weekly"
```

```typescript
// buddy-bot.config.ts (for supported ecosystems)
export default {
  packages: {
    strategy: 'all'
    // npm, composer, github-actions handled here
  }
} satisfies BuddyBotConfig
```

## Best Practices

### ✅ Do
- Start with automated migration
- Test thoroughly with dry runs
- Use dashboard for visibility
- Leverage smart grouping
- Configure auto-merge gradually

### ❌ Don't
- Remove Dependabot immediately
- Over-complicate initial setup
- Ignore migration warnings
- Skip workflow validation
- Forget to monitor first weeks

The migration from Dependabot to Buddy Bot offers enhanced features and better control, while maintaining the reliability you expect from automated dependency updates.
