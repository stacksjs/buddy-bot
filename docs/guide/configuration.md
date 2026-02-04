# Configuration

Buddy Bot can be configured through a TypeScript configuration file for full type safety.

## Configuration File

Create a `buddy-bot.config.ts` file in your project root:

```typescript
import type { BuddyBotConfig } from 'buddy-bot'

const config: BuddyBotConfig = {
  verbose: false,

  repository: {
    provider: 'github',
    owner: 'your-org',
    name: 'your-repo',
    token: process.env.GITHUB_TOKEN,
    baseBranch: 'main'
  },

  packages: {
    strategy: 'all',
    ignore: ['legacy-package'],
    groups: []
  },

  pullRequest: {
    titleFormat: 'chore(deps): {title}',
    commitMessageFormat: 'chore(deps): {message}',
    labels: ['dependencies'],
    reviewers: [],
    autoMerge: { enabled: false }
  },

  dashboard: {
    enabled: true,
    title: 'Dependency Dashboard',
    pin: true
  }
}

export default config
```

## Repository Settings

Configure how Buddy Bot interacts with your repository:

```typescript
repository: {
  // Git provider
  provider: 'github', // 'github' | 'gitlab' | 'bitbucket'

  // Repository owner (organization or user)
  owner: 'stacksjs',

  // Repository name
  name: 'buddy-bot',

  // GitHub token for API access
  token: process.env.GITHUB_TOKEN,

  // Base branch for PRs
  baseBranch: 'main'
}
```

## Package Settings

Control which packages get updated and how:

```typescript
packages: {
  // Update strategy
  strategy: 'all', // 'all' | 'major' | 'minor' | 'patch'

  // Packages to ignore
  ignore: [
    'legacy-package',
    '@types/node'
  ],

  // Group related packages
  groups: [
    {
      name: 'TypeScript Types',
      patterns: ['@types/*'],
      strategy: 'minor'
    },
    {
      name: 'ESLint Ecosystem',
      patterns: ['eslint*', '@typescript-eslint/*'],
      strategy: 'patch'
    },
    {
      name: 'React',
      patterns: ['react', 'react-dom', '@types/react*'],
      strategy: 'minor'
    }
  ]
}
```

### Package Groups

Grouping related packages creates single PRs for coordinated updates:

```typescript
groups: [
  {
    // Group name (appears in PR title)
    name: 'Testing',

    // Glob patterns to match packages
    patterns: ['vitest', '@vitest/*', 'happy-dom'],

    // Strategy for this group (overrides global)
    strategy: 'minor'
  }
]
```

## Pull Request Settings

Customize how PRs are created:

```typescript
pullRequest: {
  // PR title format
  titleFormat: 'chore(deps): {title}',

  // Commit message format
  commitMessageFormat: 'chore(deps): {message}',

  // Reviewers to assign
  reviewers: ['maintainer1', 'maintainer2'],

  // Labels to apply
  labels: ['dependencies', 'automated'],

  // Auto-merge configuration
  autoMerge: {
    enabled: true,
    strategy: 'squash', // 'merge' | 'squash' | 'rebase'
    conditions: ['patch-only']
  }
}
```

### Auto-Merge

Automatically merge PRs that meet conditions:

```typescript
autoMerge: {
  enabled: true,

  // Merge strategy
  strategy: 'squash',

  // Conditions for auto-merge
  conditions: [
    'patch-only' // Only auto-merge patch updates
  ]
}
```

## Dashboard Settings

Configure the dependency dashboard issue:

```typescript
dashboard: {
  // Enable dashboard
  enabled: true,

  // Dashboard issue title
  title: 'Dependency Dashboard',

  // Pin issue to top
  pin: true,

  // Labels for the issue
  labels: ['dependencies', 'dashboard'],

  // Assignees for the issue
  assignees: ['maintainer1'],

  // Show open PRs in dashboard
  showOpenPRs: true,

  // Show detected dependencies
  showDetectedDependencies: true
}
```

## Workflow Presets

Choose from predefined workflow configurations:

### Standard (Default)
```bash
buddy-bot setup --preset standard
```
- Dashboard updates 3x/week
- Balanced dependency updates

### High Frequency
```bash
buddy-bot setup --preset high-frequency
```
- Updates multiple times per day
- Auto-merge patch updates

### Security Focused
```bash
buddy-bot setup --preset security
```
- Frequent security patches
- Prioritizes vulnerability fixes

### Minimal
```bash
buddy-bot setup --preset minimal
```
- Weekly checks only
- Lower frequency

### Testing
```bash
buddy-bot setup --preset testing
```
- Every 5 minutes
- Dry run by default
- For development/testing

## Migration from Other Tools

### From Renovate

Buddy Bot automatically migrates settings from:
- `renovate.json`
- `.renovaterc`
- `package.json` renovate config

```bash
buddy-bot setup
# Detects and offers to migrate Renovate config
```

### From Dependabot

Migrates from:
- `.github/dependabot.yml`
- `.github/dependabot.yaml`

Settings mapped:
- Schedule intervals
- Ignore patterns
- Package ecosystems

## Integration Settings

### Slack

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

Or create `.buddy/slack-webhook`:
```
https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### Discord

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

### Jira

```bash
export JIRA_API_TOKEN="your-token"
export JIRA_BASE_URL="https://your-org.atlassian.net"
export JIRA_PROJECT_KEY="DEPS"
```

## Custom Plugins

Create custom integrations in `.buddy/plugins/`:

```jsonc
// .buddy/plugins/custom-notify.json
{
  "name": "custom-notify",
  "version": "1.0.0",
  "enabled": true,
  "triggers": [
    { "event": "setup_complete" },
    { "event": "pr_created" }
  ],
  "configuration": {
    "webhook_url": "https://your-webhook.com/notify"
  }
}
```

## Environment Configuration

Override settings via environment:

```bash
# Required for PR creation
export GITHUB_TOKEN="ghp_..."

# For updating workflow files
export BUDDY_BOT_TOKEN="ghp_..."

# Verbose output
export BUDDY_VERBOSE=true
```

## Next Steps

- Learn about [PR Generation](/guide/pr-generation) customization
- See [Usage Examples](/usage) for advanced patterns
