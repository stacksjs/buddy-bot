# Migrating from Renovate

This guide provides detailed instructions for migrating from Renovate to Buddy Bot, including configuration mappings and best practices.

## Automated Migration

Buddy Bot can automatically detect and migrate most Renovate configurations:

```bash
buddy-bot setup
```

The migration process will:
- 🔍 Detect Renovate config files (`renovate.json`, `.renovaterc`, `package.json`)
- ⚙️ Convert settings to Buddy Bot format
- ⚠️ Identify incompatible features
- 📋 Generate detailed migration report

## Configuration Mapping

### Basic Settings

| Renovate Setting | Buddy Bot Equivalent | Notes |
|-----------------|---------------------|-------|
| `extends` | N/A | Use explicit configuration instead |
| `schedule` | `schedule.cron` | Converted to cron expressions |
| `timezone` | `schedule.timezone` | Direct mapping |
| `automerge` | `pullRequest.autoMerge.enabled` | Boolean mapping |
| `automergeStrategy` | `pullRequest.autoMerge.strategy` | Strategy mapping |
| `ignoreDeps` | `packages.ignore` | Array of package names |
| `assignees` | `pullRequest.assignees` | Direct array mapping |
| `reviewers` | `pullRequest.reviewers` | Direct array mapping |

### Schedule Conversion

**Renovate Text Schedules → Cron:**

```typescript
// Renovate
{
  "schedule": ["before 6am"]
}

// Buddy Bot
{
  schedule: {
    cron: '0 4 * * *', // 4 AM daily
    timezone: 'UTC'
  }
}
```

**Common Schedule Mappings:**

| Renovate | Buddy Bot Cron | Description |
|----------|---------------|-------------|
| `"before 6am"` | `0 4 * * *` | Daily at 4 AM |
| `"every weekend"` | `0 2 * * 6` | Saturday 2 AM |
| `"after 10pm every weekday"` | `0 22 * * 1-5` | Weekdays 10 PM |
| `"before 5am on Monday"` | `0 4 * * 1` | Monday 4 AM |
| `"on the first day of the month"` | `0 2 1 * *` | Monthly, 1st at 2 AM |

### Package Rules Migration

**Simple Package Rules:**

```typescript
// Renovate
{
  "packageRules": [
    {
      "matchPackageNames": ["react", "react-dom"],
      "groupName": "React packages"
    }
  ]
}

// Buddy Bot
{
  packages: {
    groups: [
      {
        name: 'React packages',
        packages: ['react', 'react-dom'],
        updateType: 'all'
      }
    ]
  }
}
```

**Pattern-Based Rules:**

```typescript
// Renovate
{
  "packageRules": [
    {
      "matchPackagePatterns": ["^@types/"],
      "groupName": "TypeScript definitions",
      "schedule": ["before 6am on Monday"]
    }
  ]
}

// Buddy Bot
{
  packages: {
    groups: [
      {
        name: 'TypeScript definitions',
        patterns: ['^@types/'],
        updateType: 'all',
        schedule: {
          cron: '0 4 * * 1' // Monday 4 AM
        }
      }
    ]
  }
}
```

**Update Type Rules:**

```typescript
// Renovate
{
  "packageRules": [
    {
      "matchUpdateTypes": ["major"],
      "enabled": false
    },
    {
      "matchUpdateTypes": ["patch"],
      "automerge": true
    }
  ]
}

// Buddy Bot
{
  packages: {
    strategy: 'minor', // Excludes major updates
    groups: [
      {
        name: 'Patch Updates',
        patterns: ['*'],
        updateType: 'patch',
        autoMerge: true
      }
    ]
  }
}
```

### Advanced Features

**Dependency Dashboard:**

```typescript
// Renovate
{
  "dependencyDashboard": true,
  "dependencyDashboardTitle": "Dependency Updates"
}

// Buddy Bot
{
  dashboard: {
    enabled: true,
    title: 'Dependency Updates',
    pin: true,
    labels: ['dependencies']
  }
}
```

**Auto-merge Configuration:**

```typescript
// Renovate
{
  "automerge": true,
  "automergeType": "pr",
  "automergeStrategy": "squash",
  "packageRules": [
    {
      "matchUpdateTypes": ["patch"],
      "automerge": true
    },
    {
      "matchUpdateTypes": ["major"],
      "automerge": false
    }
  ]
}

// Buddy Bot
{
  pullRequest: {
    autoMerge: {
      enabled: true,
      strategy: 'squash'
    }
  },
  packages: {
    groups: [
      {
        name: 'Patch Updates',
        patterns: ['*'],
        updateType: 'patch',
        autoMerge: true
      },
      {
        name: 'Major Updates',
        patterns: ['*'],
        updateType: 'major',
        autoMerge: false
      }
    ]
  }
}
```

## Incompatible Features

Some Renovate features don't have direct equivalents in Buddy Bot:

### ❌ Not Supported
- **Preset Extensions** (`extends`): Use explicit configuration
- **Regex Managers** (`regexManagers`): Manual configuration needed
- **Custom Datasources**: Limited to npm, Composer, GitHub Actions
- **Complex Scheduling Logic**: Use cron expressions instead
- **Branch Prefix Customization**: Fixed `buddy-bot/` prefix

### ⚠️ Requires Manual Setup
- **Custom PR Templates**: Configure in `pullRequest.bodyTemplate`
- **Platform-specific Settings**: Adapt to GitHub Actions workflows
- **Complex Grouping Logic**: Simplify to pattern-based groups

## Migration Examples

### Conservative Setup

For teams wanting minimal changes:

```typescript
// Equivalent to Renovate's config:base
export default {
  schedule: {
    cron: '0 2 * * 1', // Weekly
    timezone: 'UTC'
  },
  packages: {
    strategy: 'minor', // No major updates
    ignore: [
      // Add packages you want to manage manually
    ]
  },
  pullRequest: {
    autoMerge: {
      enabled: false // Manual review required
    },
    reviewers: ['@team-leads'],
    labels: ['dependencies']
  }
} satisfies BuddyBotConfig
```

### Advanced Setup

For teams using complex Renovate configurations:

```typescript
export default {
  schedule: {
    cron: '0 2 * * *', // Daily
    timezone: 'America/New_York'
  },
  packages: {
    strategy: 'all',
    groups: [
      {
        name: 'TypeScript',
        patterns: ['^@types/', 'typescript'],
        updateType: 'all',
        autoMerge: true
      },
      {
        name: 'ESLint',
        patterns: ['^eslint', '^@typescript-eslint/'],
        updateType: 'minor',
        schedule: {
          cron: '0 2 * * 1' // Weekly for linting tools
        }
      },
      {
        name: 'React Ecosystem',
        packages: ['react', 'react-dom', '@types/react'],
        updateType: 'minor',
        autoMerge: false // Requires review
      },
      {
        name: 'Security Updates',
        patterns: ['*'],
        updateType: 'patch',
        autoMerge: true,
        labels: ['security', 'auto-merge']
      }
    ]
  },
  pullRequest: {
    autoMerge: {
      enabled: true,
      strategy: 'squash',
      conditions: ['status-success', 'no-conflicts']
    },
    titleFormat: 'chore(deps): {action} {packages}',
    labels: ['dependencies', 'automated']
  },
  dashboard: {
    enabled: true,
    title: 'Dependency Dashboard',
    pin: true,
    includePackageJson: true,
    includeGitHubActions: true
  }
} satisfies BuddyBotConfig
```

## Step-by-Step Migration

### 1. Backup Current Configuration

```bash
# Backup Renovate config
cp renovate.json renovate.json.backup
# or for package.json config
jq '.renovate' package.json > renovate-config.backup.json
```

### 2. Run Automated Migration

```bash
buddy-bot setup
```

Review the migration report and note any warnings or incompatible features.

### 3. Test Configuration

```bash
# Test scanning
buddy-bot scan --verbose

# Test update process (dry run)
buddy-bot update --dry-run
```

### 4. Validate Generated Workflows

Check the generated GitHub Actions workflows:
- `.github/workflows/buddy-dashboard.yml`
- `.github/workflows/buddy-check.yml`
- `.github/workflows/buddy-update.yml`

### 5. Gradual Transition

1. **Week 1**: Run both Renovate and Buddy Bot in parallel
2. **Week 2**: Compare PR quality and timing
3. **Week 3**: Disable Renovate, monitor Buddy Bot
4. **Week 4**: Remove Renovate configuration

### 6. Cleanup

```bash
# Remove Renovate files
rm renovate.json .renovaterc .renovaterc.json

# Remove package.json renovate config
npm pkg delete renovate

# Disable Renovate app in GitHub (if installed)
# Visit: https://github.com/settings/installations
```

## Troubleshooting

### Common Issues

**Complex scheduling not migrated correctly:**
```typescript
// Convert manually using cron expressions
// Use: https://crontab.guru/ for help
```

**Package rules too complex:**
```typescript
// Simplify to basic patterns and groups
// Use multiple groups instead of complex rules
```

**Custom managers not working:**
```typescript
// Buddy Bot focuses on standard package managers
// For custom files, consider manual updates
```

### Getting Help

- 📖 Check the main [Migration Guide](/advanced/migration)
- 🔧 Review [Configuration](/config) options
- 💬 Ask in [Discord](https://discord.gg/stacksjs)
- 🐛 Report issues on [GitHub](https://github.com/stacksjs/buddy/issues)

## Best Practices

### ✅ Do
- Start with automated migration
- Test thoroughly before removing Renovate
- Simplify complex configurations
- Use standard cron expressions
- Monitor PR quality during transition

### ❌ Don't
- Remove Renovate immediately
- Ignore migration warnings
- Use overly complex grouping
- Skip dry-run testing
- Forget to update team documentation

Renovate's flexibility comes with complexity. Buddy Bot aims for simplicity while maintaining power - your migration might be a good opportunity to simplify your dependency management strategy.
