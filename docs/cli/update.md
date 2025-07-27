# Update Commands

Commands for scanning dependencies and creating pull requests with updates.

## scan

Scan for dependency updates without making any changes.

### Usage

```bash
buddy-bot scan [options]
```

### Options

- `--verbose, -v` - Enable verbose logging
- `--packages <names>` - Comma-separated list of packages to check
- `--pattern <pattern>` - Glob pattern to match packages
- `--strategy <type>` - Update strategy: major|minor|patch|all (default: all)
- `--ignore <names>` - Comma-separated list of packages to ignore

### Examples

```bash
# Basic scan
buddy-bot scan

# Verbose output
buddy-bot scan --verbose

# Scan specific packages
buddy-bot scan --packages "react,typescript"

# Use glob patterns
buddy-bot scan --pattern "@types/*"

# Scan with strategy filter
buddy-bot scan --strategy minor

# Ignore specific packages
buddy-bot scan --ignore "eslint,prettier"
```

### Output

```bash
✓ Found 3 package updates

📦 Non-Major Dependencies (3 updates)
  react: ^18.2.0 → ^18.3.1 (minor)
  typescript: ^5.3.3 → ^5.4.2 (minor)
  @types/node: ^20.10.0 → ^20.11.5 (minor)

🔒 Security: 0 packages
⚠️  Breaking: 0 packages
📈 Total: 3 packages ready for update
```

## update

Update dependencies and create pull requests.

### Usage

```bash
buddy-bot update [options]
```

### Options

- `--verbose, -v` - Enable verbose logging
- `--strategy <type>` - Update strategy: major|minor|patch|all (default: all)
- `--ignore <names>` - Comma-separated list of packages to ignore
- `--dry-run` - Preview changes without making them

### Examples

```bash
# Update all dependencies
buddy-bot update

# Preview what would be updated
buddy-bot update --dry-run

# Update only patch versions
buddy-bot update --strategy patch

# Verbose output
buddy-bot update --verbose

# Ignore specific packages
buddy-bot update --ignore "@types/node,eslint"
```

### Dry Run Output

```bash
🔍 Dry run mode - no changes will be made
Would create 2 pull request(s):
  📝 chore(deps): update all non-major dependencies (3 updates)
  📝 chore(deps): update dependency react to v19.0.0 (1 update)
```

### Process Flow

1. **Scan**: Analyzes project for outdated dependencies
2. **Group**: Organizes updates by type (major/minor/patch)
3. **Branch**: Creates feature branches with timestamp
4. **Commit**: Updates package.json with new versions
5. **PR**: Creates pull request with detailed information
6. **Labels**: Applies dynamic labels based on update types

## rebase

Rebase/retry a pull request with latest updates.

### Usage

```bash
buddy-bot rebase <pr-number> [options]
```

### Parameters

- `<pr-number>` - Pull request number to rebase

### Options

- `--verbose, -v` - Enable verbose logging
- `--force` - Force rebase even if PR appears up to date

### Examples

```bash
# Rebase PR #17
buddy-bot rebase 17

# Verbose rebase
buddy-bot rebase 17 --verbose

# Force rebase even if up to date
buddy-bot rebase 17 --force
```

### Process

1. **Validation**: Checks if PR exists and is a buddy-bot PR
2. **Analysis**: Extracts current package updates from PR body
3. **Comparison**: Scans for latest versions
4. **Update**: Updates existing PR in-place (preserves PR number)
5. **Notification**: Updates PR content and labels

### Output

```bash
🔄 Rebasing/retrying PR #17...
📋 Found PR: chore(deps): update dependencies
🌿 Branch: buddy-bot/update-dependencies-1704123456789
📦 Found 2 packages to update
🔍 Checking if rebase is needed...
🔄 Updating PR with latest updates...
✅ Updated existing PR #17: chore(deps): update all non-major dependencies
🔗 https://github.com/your-org/your-repo/pull/17
```

## update-check

Auto-detect and rebase PRs with checked rebase boxes.

### Usage

```bash
buddy-bot update-check [options]
```

### Options

- `--verbose, -v` - Enable verbose logging
- `--dry-run` - Check but don't actually rebase

### Examples

```bash
# Check and rebase marked PRs
buddy-bot update-check

# Preview what would be rebased
buddy-bot update-check --dry-run

# Verbose output
buddy-bot update-check --verbose
```

### Rebase Checkbox Format

PRs include this checkbox for manual rebase triggers:

```markdown
---
 - [ ] <!-- rebase-check -->If you want to update/retry this PR, check this box
---
```

When checked (marked with `x`):

```markdown
 - [x] <!-- rebase-check -->If you want to update/retry this PR, check this box
```

### Process

1. **Discovery**: Finds all open buddy-bot PRs
2. **Detection**: Scans PR bodies for checked rebase boxes
3. **Validation**: Extracts package updates from PR content
4. **Rebase**: Updates each marked PR with latest versions
5. **Reset**: Unchecks the rebase box after completion

### Output

```bash
🔍 Checking for PRs with rebase checkbox enabled...
📋 Found 3 buddy-bot PR(s)
🔄 PR #17 has rebase checkbox checked: chore(deps): update dependencies
🔄 Rebasing PR #17...
✅ Successfully rebased PR #17
🔄 PR #20 has rebase checkbox checked: chore(deps): update typescript
🔄 Rebasing PR #20...
✅ Successfully rebased PR #20
✅ Rebased 2 PR(s) successfully
```

## Configuration Integration

All update commands respect configuration from `buddy-bot.config.ts`:

### Strategy Override

```typescript
// Config strategy can be overridden by CLI
export default {
  packages: {
    strategy: 'patch' // Default strategy
  }
}
```

```bash
# Override config strategy
buddy-bot update --strategy minor
```

### Ignore Lists

```typescript
// Combine config and CLI ignore lists
export default {
  packages: {
    ignore: ['@types/node'] // Always ignored
  }
}
```

```bash
# Additional ignores for this run
buddy-bot update --ignore "eslint,prettier"
# Result: ignores @types/node, eslint, and prettier
```

## Error Handling

### Common Errors

**Repository not configured:**
```bash
❌ Repository configuration required for PR creation
Configure repository.provider, repository.owner, repository.name in buddy-bot.config.ts
```

**Missing GitHub token:**
```bash
❌ GITHUB_TOKEN environment variable required for PR creation
```

**Invalid PR number:**
```bash
❌ Invalid PR number provided
```

**PR not found:**
```bash
❌ Could not find open PR #17
```

**Not a buddy-bot PR:**
```bash
❌ PR #17 is not a buddy-bot PR (branch: feature/custom-update)
```

### Troubleshooting

**No updates found:**
- Check if packages are in ignore list
- Verify update strategy allows available updates
- Ensure dependencies are actually outdated

**Permission errors:**
- Verify GitHub token has correct permissions
- Check repository settings allow Actions to create PRs
- Use `buddy-bot open-settings` for quick access

**Rebase fails:**
- Ensure PR is still open
- Check if branch exists
- Verify PR contains valid package update information

## Best Practices

### Update Strategies

1. **Start Conservative**: Use `patch` strategy initially
2. **Test Major Updates**: Always review breaking changes manually
3. **Group Related Updates**: Let Buddy group ecosystem packages
4. **Monitor CI**: Ensure tests pass before merging

### PR Management

1. **Regular Rebasing**: Use `update-check` in automation
2. **Batch Reviews**: Review multiple patch updates together
3. **Label Organization**: Use labels for workflow automation
4. **Merge Hygiene**: Use squash merging for clean history

### Automation Integration

```yaml
# .github/workflows/dependencies.yml
name: Dependency Updates

on:
  schedule:
    - cron: '0 2 * * 1' # Weekly on Monday
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
        run: bunx buddy-bot update --strategy patch --verbose
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Auto-rebase existing PRs
        run: bunx buddy-bot update-check --verbose
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
