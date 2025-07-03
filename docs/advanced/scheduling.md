# Scheduling & Automation

Buddy provides flexible scheduling capabilities to automate dependency updates with precise timing and intelligent strategies.

## Cron-Based Scheduling

Configure automated updates using cron expressions for precise timing control.

### Basic Scheduling

```typescript
export default {
  schedule: {
    // Weekly updates on Monday at 2 AM UTC
    cron: '0 2 * * 1',
    timezone: 'UTC',

    // Enable/disable scheduling
    enabled: true,

    // Maximum execution time
    timeout: 3600 // 1 hour
  }
} satisfies BuddyBotConfig
```

### Common Patterns

```typescript
const cronPatterns = {
  // Daily at 2 AM
  daily: '0 2 * * *',

  // Weekly on Monday at 2 AM
  weekly: '0 2 * * 1',

  // Weekdays at 9 AM
  weekdays: '0 9 * * 1-5',

  // Every 6 hours
  sixHourly: '0 */6 * * *',

  // Monthly on 1st at midnight
  monthly: '0 0 1 * *',

  // Quarterly (1st of Jan, Apr, Jul, Oct)
  quarterly: '0 0 1 1,4,7,10 *'
}
```

### Multiple Schedules

```typescript
export default {
  schedules: [
    {
      name: 'security-updates',
      cron: '0 */6 * * *', // Every 6 hours
      strategy: 'patch',
      autoMerge: true,
      labels: ['security', 'auto-merge']
    },
    {
      name: 'weekly-updates',
      cron: '0 2 * * 1', // Weekly Monday
      strategy: 'minor',
      reviewers: ['team-lead'],
      labels: ['dependencies', 'weekly']
    },
    {
      name: 'monthly-major',
      cron: '0 3 1 * *', // Monthly 1st
      strategy: 'major',
      reviewers: ['senior-dev', 'tech-lead'],
      labels: ['major-update', 'breaking-changes']
    }
  ]
} satisfies BuddyBotConfig
```

## GitHub Actions Integration

Seamless integration with GitHub Actions for automated scheduling.

### Basic Workflow

```yaml
name: Dependency Updates
on:
  schedule:
    - cron: '0 2 * * 1' # Weekly on Monday at 2 AM
  workflow_dispatch: # Allow manual trigger

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      actions: write

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bunx buddy-bot update
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Workflow with Matrix

```yaml
name: Multi-Strategy Updates
on:
  schedule:
    - cron: '0 2 * * 1' # Weekly
    - cron: '0 14 * * 3' # Mid-week security check

jobs:
  update:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - strategy: patch
            auto-merge: true
            labels: 'patch-update,auto-merge'
          - strategy: minor
            reviewers: team-lead
            labels: minor-update
          - strategy: major
            reviewers: 'senior-dev,tech-lead'
            labels: 'major-update,breaking-changes'

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: |
          bunx buddy-bot update \
            --strategy ${{ matrix.strategy }} \
            --labels "${{ matrix.labels }}" \
            ${{ matrix.reviewers && format('--reviewers "{0}"', matrix.reviewers) || '' }} \
            ${{ matrix.auto-merge && '--auto-merge' || '' }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Conditional Scheduling

Execute updates based on specific conditions and triggers.

### Environment-Based Scheduling

```typescript
export default {
  schedule: {
    environments: {
      development: {
        cron: '0 2 * * *', // Daily
        strategy: 'all',
        autoMerge: true
      },
      staging: {
        cron: '0 2 * * 1,3,5', // Mon, Wed, Fri
        strategy: 'minor',
        reviewers: ['qa-team']
      },
      production: {
        cron: '0 2 * * 1', // Weekly
        strategy: 'patch',
        reviewers: ['tech-lead', 'senior-dev'],
        requireApproval: true
      }
    }
  }
} satisfies BuddyBotConfig
```

### Trigger-Based Updates

```typescript
const triggerBasedUpdates = {
  schedule: {
    triggers: {
      // Security vulnerability detected
      security: {
        enabled: true,
        immediate: true,
        strategy: 'patch',
        autoMerge: true,
        notifications: ['security-team']
      },

      // Major release available
      majorRelease: {
        enabled: true,
        delay: 86400, // Wait 24 hours
        strategy: 'major',
        requireDiscussion: true
      },

      // Dependency count threshold
      batchThreshold: {
        enabled: true,
        threshold: 10, // When 10+ packages need updates
        strategy: 'minor',
        groupByEcosystem: true
      }
    }
  }
}
```

## Smart Scheduling

Intelligent scheduling based on project patterns and team workflows.

### Adaptive Scheduling

```typescript
const adaptiveSchedulingConfig = {
  schedule: {
    adaptive: {
      enabled: true,

      // Learn from team patterns
      learning: {
        trackMergePatterns: true,
        trackReviewTimes: true,
        adaptToTeamVelocity: true
      },

      // Auto-adjust timing
      optimization: {
        avoidBusyPeriods: true,
        preferLowActivity: true,
        respectTimeZones: true
      },

      // Feedback loop
      feedback: {
        trackSuccess: true,
        adjustFrequency: true,
        skipFailedStrategies: true
      }
    }
  }
}
```

### Workload-Aware Scheduling

```typescript
const workloadAwareSchedulingConfig = {
  schedule: {
    workload: {
      enabled: true,

      // Monitor team capacity
      capacity: {
        maxOpenPRs: 5, // Don't create if 5+ PRs open
        maxReviewLoad: 10, // Consider reviewer workload
        respectVacations: true // Check team calendar
      },

      // Dynamic frequency
      frequency: {
        baseFrequency: 'weekly',
        adjustments: {
          highActivity: 'reduce', // Reduce during busy periods
          lowActivity: 'increase', // Increase during quiet periods
          holidays: 'pause' // Pause during holidays
        }
      }
    }
  }
}
```

## Advanced Scheduling Features

### Time Zone Management

```typescript
const timezoneConfig = {
  schedule: {
    timezones: {
      // Team time zones
      team: {
        alice: 'America/New_York',
        bob: 'Europe/London',
        charlie: 'Asia/Tokyo'
      },

      // Scheduling preferences
      preferences: {
        respectBusinessHours: true,
        maxTimezoneSpread: 8, // Max 8 hour difference
        preferMajorityTimezone: true
      },

      // Override for urgency
      urgentOverrides: {
        security: true, // Security updates ignore TZ
        critical: true // Critical updates ignore TZ
      }
    }
  }
}
```

### Rollback Scheduling

```typescript
const rollbackConfig = {
  schedule: {
    rollback: {
      enabled: true,

      // Automatic rollback triggers
      triggers: {
        failedChecks: true, // CI failures
        conflicts: true, // Merge conflicts
        teamRejection: true // Team requests rollback
      },

      // Rollback timing
      timing: {
        gracePeriod: 3600, // 1 hour grace period
        maxRollbackWindow: 86400, // 24 hour window
        notifyBeforeRollback: true
      }
    }
  }
}
```

## Monitoring & Observability

Track scheduling performance and team impact.

### Metrics Collection

```typescript
const metricsConfig = {
  schedule: {
    monitoring: {
      enabled: true,

      // Metrics to track
      metrics: {
        executionTime: true,
        successRate: true,
        teamSatisfaction: true,
        updateVelocity: true
      },

      // Alerting
      alerts: {
        failureThreshold: 0.8, // Alert if <80% success
        executionTimeout: 7200, // Alert if >2 hours
        teamFeedback: 'negative' // Alert on negative feedback
      },

      // Reporting
      reports: {
        frequency: 'weekly',
        recipients: ['tech-lead'],
        includeRecommendations: true
      }
    }
  }
}
```

### Dashboard Integration

```typescript
const dashboardConfig = {
  schedule: {
    dashboard: {
      enabled: true,

      // External integrations
      integrations: {
        grafana: {
          endpoint: 'https://grafana.company.com',
          apiKey: process.env.GRAFANA_API_KEY
        },
        slack: {
          webhook: process.env.SLACK_WEBHOOK,
          channel: '#dependency-updates'
        },
        teams: {
          webhook: process.env.TEAMS_WEBHOOK
        }
      }
    }
  }
}
```

## CLI Scheduling Commands

Manage schedules via command line interface.

### Schedule Management

```bash
# List active schedules
buddy-bot schedule list

# Create new schedule
buddy-bot schedule create --name "security" --cron "0 */6 * * *" --strategy patch

# Update existing schedule
buddy-bot schedule update security --cron "0 */4 * * *"

# Disable schedule
buddy-bot schedule disable security

# Test schedule
buddy-bot schedule test security --dry-run

# Manual trigger
buddy-bot schedule run security --force
```

### Schedule Analysis

```bash
# Analyze schedule performance
buddy-bot schedule analyze --since "7 days ago"

# Check next execution times
buddy-bot schedule next

# Validate cron expressions
buddy-bot schedule validate "0 2 * * 1"

# Optimize schedules
buddy-bot schedule optimize --suggest
```

## Integration Examples

### Enterprise Configuration

```typescript
export default {
  schedules: [
    {
      name: 'security-immediate',
      trigger: 'security-alert',
      strategy: 'patch',
      autoMerge: true,
      notifications: ['security-team', 'on-call']
    },
    {
      name: 'maintenance-window',
      cron: '0 2 * * 0', // Sunday 2 AM
      strategy: 'all',
      maintainanceMode: true,
      rollbackWindow: 86400
    },
    {
      name: 'dev-environment',
      cron: '0 9 * * 1-5', // Weekdays 9 AM
      strategy: 'major',
      environment: 'development',
      autoMerge: true
    }
  ],

  // Global scheduling preferences
  preferences: {
    respectHolidays: true,
    pauseDuringIncidents: true,
    teamCapacityThreshold: 0.8
  }
} satisfies BuddyBotConfig
```

See [GitHub Actions Integration](/features/github-actions) for more workflow examples.
