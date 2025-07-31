# Migration Guide

This guide helps you migrate from existing dependency management tools like Renovate and Dependabot to Buddy Bot.

## Automated Migration

Buddy Bot includes automated migration capabilities to ease the transition from other tools.

### Interactive Migration

Run the setup command to automatically detect and migrate existing configurations:

```bash
buddy-bot setup
```

This will:
- 🔍 **Detect** existing Renovate and Dependabot configurations
- ⚙️ **Convert** settings to Buddy Bot format
- 📋 **Generate** migration report with compatibility notes
- 🚀 **Setup** new workflows and configuration

### Supported Migration Sources

| Tool | Config Files | Migration Quality |
|------|-------------|-------------------|
| **Renovate** | `renovate.json`, `.renovaterc`, `package.json` | ✅ High |
| **Dependabot** | `.github/dependabot.yml` | ⚠️ Medium |

## Manual Migration

### From Renovate

#### Basic Configuration

**Before (Renovate):**
```json
{
  "extends": ["config:base"],
  "schedule": ["before 6am"],
  "automerge": true,
  "ignoreDeps": ["react", "@types/node"]
}
```

**After (Buddy Bot):**
```typescript
export default {
  schedule: {
    cron: '0 4 * * *', // 4 AM daily
    timezone: 'UTC'
  },
  packages: {
    strategy: 'all',
    ignore: ['react', '@types/node']
  },
  pullRequest: {
    autoMerge: {
      enabled: true,
      strategy: 'squash'
    }
  }
} satisfies BuddyBotConfig
```

#### Package Rules & Grouping

**Before (Renovate):**
```json
{
  "packageRules": [
    {
      "matchPackagePatterns": ["^@types/"],
      "groupName": "TypeScript definitions"
    },
    {
      "matchPackageNames": ["eslint"],
      "enabled": false
    }
  ]
}
```

**After (Buddy Bot):**
```typescript
export default {
  packages: {
    strategy: 'all',
    ignore: ['eslint'],
    groups: [
      {
        name: 'TypeScript definitions',
        patterns: ['^@types/'],
        updateType: 'minor'
      }
    ]
  }
} satisfies BuddyBotConfig
```

#### Advanced Scheduling

**Before (Renovate):**
```json
{
  "schedule": ["every weekend"],
  "timezone": "America/New_York",
  "packageRules": [
    {
      "matchUpdateTypes": ["major"],
      "schedule": ["on the first day of the month"]
    }
  ]
}
```

**After (Buddy Bot):**
```typescript
export default {
  schedule: {
    cron: '0 2 * * 6', // Saturday 2 AM
    timezone: 'America/New_York'
  },
  packages: {
    strategy: 'minor', // Default to minor updates
    groups: [
      {
        name: 'Major Updates',
        patterns: ['*'],
        updateType: 'major',
        schedule: {
          cron: '0 2 1 * *' // First day of month
        }
      }
    ]
  }
} satisfies BuddyBotConfig
```

### From Dependabot

#### Basic Configuration

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
      - dependency-name: "@types/*"
```

**After (Buddy Bot):**
```typescript
export default {
  schedule: {
    cron: '0 2 * * 1', // Weekly on Monday 2 AM
    timezone: 'UTC'
  },
  packages: {
    strategy: 'all',
    ignore: ['react', '@types/*']
  }
} satisfies BuddyBotConfig
```

#### Multiple Ecosystems

**Before (Dependabot):**
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
```

**After (Buddy Bot):**
```typescript
export default {
  schedule: {
    cron: '0 2 * * *', // Daily at 2 AM
    timezone: 'UTC'
  },
  packages: {
    strategy: 'all',
    groups: [
      {
        name: 'npm packages',
        patterns: ['*'],
        files: ['package.json'],
        updateType: 'all'
      },
      {
        name: 'Composer packages',
        patterns: ['*'],
        files: ['composer.json'],
        updateType: 'all',
        schedule: {
          cron: '0 2 * * 1' // Weekly
        }
      },
      {
        name: 'GitHub Actions',
        patterns: ['*'],
        files: ['.github/workflows/*.yml'],
        updateType: 'all',
        schedule: {
          cron: '0 2 1 * *' // Monthly
        }
      }
    ]
  }
} satisfies BuddyBotConfig
```

## Migration Mapping

### Schedule Conversion

| Renovate | Dependabot | Buddy Bot | Description |
|----------|------------|-----------|-------------|
| `"before 6am"` | `daily` | `0 4 * * *` | Daily at 4 AM |
| `"every weekend"` | `weekly` | `0 2 * * 6` | Saturday 2 AM |
| `"monthly"` | `monthly` | `0 2 1 * *` | 1st of month 2 AM |

### Update Strategy Mapping

| Renovate | Dependabot | Buddy Bot | Notes |
|----------|------------|-----------|-------|
| `automergeType: "patch"` | N/A | `strategy: "patch"` | Patch updates only |
| `separatePatchReleases: false` | N/A | `strategy: "minor"` | Minor + patch |
| `separateMajorReleases: false` | N/A | `strategy: "all"` | All updates |

### Grouping & Patterns

| Renovate | Buddy Bot | Example |
|----------|-----------|---------|
| `matchPackagePatterns` | `patterns` | `["^@types/", "^eslint"]` |
| `matchPackageNames` | `packages` | `["react", "typescript"]` |
| `matchUpdateTypes` | `updateType` | `"major"`, `"minor"`, `"patch"` |

## Configuration Examples

### Conservative Migration
For teams wanting minimal disruption:

```typescript
export default {
  schedule: {
    cron: '0 2 * * 1', // Weekly Monday 2 AM
    timezone: 'UTC'
  },
  packages: {
    strategy: 'patch', // Only patch updates
    excludeMajor: true,
    ignore: [
      // Add packages you want to update manually
      'react',
      'typescript',
      '@types/node'
    ]
  },
  pullRequest: {
    autoMerge: {
      enabled: false // Manual review required
    },
    reviewers: ['@team-leads'],
    labels: ['dependencies', 'review-required']
  }
} satisfies BuddyBotConfig
```

### Aggressive Migration
For teams wanting frequent updates:

```typescript
export default {
  schedule: {
    cron: '0 2 * * *', // Daily 2 AM
    timezone: 'UTC'
  },
  packages: {
    strategy: 'all',
    includePrerelease: false, // Stable releases only
    groups: [
      {
        name: 'Patch Updates',
        patterns: ['*'],
        updateType: 'patch',
        autoMerge: true
      },
      {
        name: 'Minor Updates',
        patterns: ['*'],
        updateType: 'minor',
        schedule: {
          cron: '0 2 * * 1' // Weekly for minor
        }
      },
      {
        name: 'Major Updates',
        patterns: ['*'],
        updateType: 'major',
        schedule: {
          cron: '0 2 1 * *' // Monthly for major
        },
        autoMerge: false
      }
    ]
  }
} satisfies BuddyBotConfig
```

## Workflow Migration

### GitHub Actions Setup

Buddy Bot automatically generates optimized GitHub Actions workflows:

```bash
# Run setup to generate workflows
buddy-bot setup

# Generated files:
# .github/workflows/buddy-dashboard.yml
# .github/workflows/buddy-check.yml
# .github/workflows/buddy-update.yml
```

### Removing Old Configurations

After successful migration:

```bash
# Remove Renovate files
rm -f renovate.json .renovaterc .renovaterc.json

# Remove Dependabot config
rm -f .github/dependabot.yml .github/dependabot.yaml

# Remove package.json renovate config
# Edit package.json and remove "renovate" key
```

## Validation & Testing

### Dry Run Migration

Test your configuration before going live:

```bash
# Preview what would be updated
buddy-bot scan --verbose

# Test update process without creating PRs
buddy-bot update --dry-run
```

### Gradual Rollout

1. **Week 1**: Setup Buddy Bot alongside existing tool
2. **Week 2**: Compare PR quality and timing
3. **Week 3**: Disable old tool, monitor Buddy Bot
4. **Week 4**: Remove old configurations

## Troubleshooting

### Common Issues

**❌ Migration detected incompatible features**
```
Solution: Review migration report warnings and manually configure advanced features
```

**❌ Schedule conflicts**
```
Solution: Disable old tool first, then setup Buddy Bot schedules
```

**❌ PR format differences**
```
Solution: Customize PR templates in buddy-bot.config.ts
```

### Getting Help

- 📖 Check the [Configuration Guide](/config)
- 🐛 Review [GitHub Issues](https://github.com/stacksjs/buddy/issues)
- 💬 Ask in [Discord](https://discord.gg/stacksjs)

## Best Practices

### ✅ Do
- Run migration during low-activity periods
- Test with dry-run first
- Keep old configurations until Buddy Bot is proven stable
- Monitor first few weeks closely
- Document any custom configurations needed

### ❌ Don't
- Migrate during critical deployment periods
- Remove old tools immediately
- Ignore migration warnings
- Skip validation testing
- Forget to update team documentation

## Next Steps

After migration:

1. 📊 **Dashboard**: Enable dependency dashboard for visibility
2. 🔧 **Customize**: Fine-tune grouping and scheduling
3. 🚀 **Automate**: Configure auto-merge for trusted updates
4. 📈 **Monitor**: Track update frequency and PR quality
5. 🎯 **Optimize**: Adjust strategies based on team workflow

The migration process ensures a smooth transition while maintaining your existing dependency management practices and improving upon them with Buddy Bot's advanced features.
