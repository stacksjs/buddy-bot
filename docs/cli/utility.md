# Utility Commands

Utility commands for configuration, scheduling, and repository management.

## open-settings

Open GitHub repository and organization settings in your browser.

```bash
buddy-bot open-settings [options]
```

### Description

Quickly open the GitHub settings pages needed to configure permissions for buddy-bot. This includes repository settings, organization settings, and Actions configurations.

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--type <type>` | Settings type to open | `'repo'` |
| `--verbose, -v` | Enable verbose logging | `false` |

### Settings Types

- **`repo`** - Repository settings page
- **`actions`** - Repository Actions settings
- **`org`** - Organization settings
- **`tokens`** - Personal access tokens page

### Examples

```bash
# Open repository settings
buddy-bot open-settings

# Open Actions settings
buddy-bot open-settings --type actions

# Open organization settings
buddy-bot open-settings --type org

# Open personal tokens page
buddy-bot open-settings --type tokens
```

### What Opens

**Repository Settings (`--type repo`)**
- General repository settings
- Collaborators and teams
- Branches and protection rules

**Actions Settings (`--type actions`)**
- GitHub Actions permissions
- Workflow permissions
- Runner settings

**Organization Settings (`--type org`)**
- Member privileges
- Third-party access
- GitHub Apps

**Tokens (`--type tokens`)**
- Personal access tokens management
- Fine-grained tokens

## schedule

Run automated updates on a schedule.

```bash
buddy-bot schedule [options]
```

### Description

Execute buddy-bot updates on a predefined schedule. This command is typically used in CI/CD environments or cron jobs for automated dependency management.

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--cron <expression>` | Cron expression for scheduling | From config |
| `--timezone <tz>` | Timezone for scheduling | `'UTC'` |
| `--dry-run` | Show what would be updated without making changes | `false` |
| `--strategy <type>` | Update strategy override | From config |
| `--verbose, -v` | Enable verbose logging | `false` |

### Examples

```bash
# Run scheduled updates (uses config)
buddy-bot schedule

# Override cron schedule
buddy-bot schedule --cron "0 2 * * 1"

# Different timezone
buddy-bot schedule --timezone "America/New_York"

# Dry run to preview changes
buddy-bot schedule --dry-run

# Override update strategy
buddy-bot schedule --strategy patch
```

### Cron Expressions

Common scheduling patterns:

```bash
# Every day at 2 AM UTC
buddy-bot schedule --cron "0 2 * * *"

# Weekly on Monday at 2 AM
buddy-bot schedule --cron "0 2 * * 1"

# Every 6 hours
buddy-bot schedule --cron "0 */6 * * *"

# Weekdays at 9 AM
buddy-bot schedule --cron "0 9 * * 1-5"
```

### Configuration Integration

The schedule command uses settings from `buddy-bot.config.ts`:

```typescript
export default {
  schedule: {
    cron: '0 2 * * 1', // Weekly on Monday at 2 AM
    timezone: 'UTC',
  },
  packages: {
    strategy: 'patch', // Used by scheduler
  },
} satisfies BuddyBotConfig
```

### CI/CD Integration

**GitHub Actions**
```yaml
name: Scheduled Dependencies
on:
  schedule:
    - cron: '0 2 * * 1'

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bunx buddy-bot schedule
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Cron Job**
```bash
# Add to crontab
0 2 * * 1 cd /path/to/project && bunx buddy-bot schedule
```

### Output

The schedule command provides detailed information about:

- **Execution time** and timezone
- **Updates found** and strategy used
- **Pull requests created** or updated
- **Errors** and warnings

### Troubleshooting

**Schedule not running:**
- Check cron expression syntax
- Verify timezone settings
- Ensure GitHub token is valid

**No updates found:**
- Run with `--verbose` for detailed scanning
- Check package ignore list
- Verify package.json exists

**Permission errors:**
- Check GitHub token scopes
- Verify repository access
- Review workflow permissions
