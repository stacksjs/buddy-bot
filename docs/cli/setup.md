# Setup Commands

Interactive setup and configuration for buddy-bot.

## setup

Interactive setup wizard for automated dependency updates.

```bash
buddy-bot setup [options]
```

### Description

The setup command guides you through configuring buddy-bot for your project. It creates the necessary configuration files, sets up GitHub Actions workflows, and helps configure repository settings.

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--template <type>` | Configuration template to use | `'standard'` |
| `--dry-run` | Show what would be created without making changes | `false` |
| `--force` | Overwrite existing configuration files | `false` |
| `--verbose, -v` | Enable verbose logging | `false` |

### Templates

Available configuration templates:

- **`standard`** - Basic configuration for most projects
- **`comprehensive`** - Full-featured configuration with all options
- **`security`** - Security-focused updates only
- **`minimal`** - Minimal configuration for simple projects

### Examples

```bash
# Interactive setup with default template
buddy-bot setup

# Use comprehensive template
buddy-bot setup --template comprehensive

# Preview changes without creating files
buddy-bot setup --dry-run

# Force overwrite existing configuration
buddy-bot setup --force
```

### Interactive Flow

The setup wizard will ask about:

1. **Repository Information**
   - Git provider (GitHub, GitLab, etc.)
   - Repository owner and name
   - Base branch

2. **Update Strategy**
   - Package update strategy (patch, minor, major, all)
   - Packages to ignore
   - Package groupings

3. **Pull Request Settings**
   - Reviewers and assignees
   - Labels to apply
   - Auto-merge configuration

4. **Scheduling**
   - Update frequency
   - GitHub Actions workflow generation

### Generated Files

The setup process creates:

- `buddy-bot.config.ts` - Main configuration file
- `.github/workflows/dependencies.yml` - GitHub Actions workflow (optional)
- `.gitignore` updates - Ignore buddy-bot cache files

### Configuration Example

Generated `buddy-bot.config.ts`:

```typescript
import type { BuddyBotConfig } from 'buddy-bot'

export default {
  repository: {
    provider: 'github',
    owner: 'your-org',
    name: 'your-repo',
  },
  packages: {
    strategy: 'patch',
    ignore: ['@types/node'],
  },
  pullRequest: {
    reviewers: ['team-lead'],
    labels: ['dependencies', 'automated'],
  },
  schedule: {
    cron: '0 2 * * 1', // Weekly on Monday at 2 AM
  },
} satisfies BuddyBotConfig
```

### GitHub Actions Workflow

Generated `.github/workflows/dependencies.yml`:

```yaml
name: Dependency Updates
on:
  schedule:
    - cron: '0 2 * * 1'
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bunx buddy-bot update
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Post-Setup Steps

After running setup:

1. **Review Configuration**
   ```bash
   # Check configuration
   buddy-bot scan --dry-run
   ```

2. **Test GitHub Integration**
   ```bash
   # Test GitHub permissions
   buddy-bot scan --verbose
   ```

3. **Commit Changes**
   ```bash
   git add buddy-bot.config.ts .github/workflows/
   git commit -m "Add buddy-bot configuration"
   ```

### Troubleshooting

**Setup fails with permission error:**
- Ensure you have write access to the repository
- Check GitHub token permissions

**Configuration validation fails:**
- Review the generated config file
- Run `buddy-bot scan --verbose` for detailed errors

**GitHub Actions workflow not working:**
- Check repository settings > Actions > General
- Ensure workflow permissions are enabled
