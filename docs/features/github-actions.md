# GitHub Actions Integration

Buddy automatically detects and updates GitHub Actions workflow dependencies, keeping your automation infrastructure current with the latest action versions and security patches.

## Overview

GitHub Actions integration provides:

- **Automatic Detection** - Scans `.github/workflows/` for action dependencies
- **Version Updates** - Fetches latest releases from GitHub API
- **Workflow Preservation** - Updates versions while maintaining exact formatting
- **Comprehensive PRs** - Dedicated table in pull requests for action updates
- **Security Focus** - Prioritizes critical action updates for workflow security

## Supported Files

Buddy automatically detects GitHub Actions in:

```
.github/
└── workflows/
    ├── ci.yml
    ├── release.yaml
    ├── deploy.yml
    └── tests.yaml
```

Both `.yml` and `.yaml` extensions are supported for maximum compatibility.

## Action Detection

Buddy parses workflow files to find `uses:` statements and extract action dependencies:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4 # ← Detected & updated

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2 # ← Detected & updated

      - name: Cache dependencies
        uses: actions/cache@v4.1.0 # ← Detected & updated
        with:
          path: ~/.bun
          key: ${{ runner.os }}-bun-${{ hashFiles('**/bun.lockb') }}
```

### Supported Action Formats

- **Standard actions**: `actions/checkout@v4`
- **Third-party actions**: `oven-sh/setup-bun@v2`
- **Versioned actions**: `actions/cache@v4.1.0`
- **Quoted actions**: `"actions/setup-node@v4"`
- **Single-quoted**: `'actions/upload-artifact@v3'`

### Excluded Actions

- **Local actions**: `./local-action` (relative paths)
- **Docker actions**: `docker://node:18` (docker images)
- **Composite actions**: Actions without `@version` syntax

## Pull Request Integration

GitHub Actions updates appear in a dedicated table within pull requests:

### GitHub Actions Table

```markdown
### GitHub Actions

| Action | Change | File | Status |
|--------|--------|------|--------|
| [actions/checkout](https://github.com/actions/checkout) | `v4` → `v4.2.2` | ci.yml | ✅ Available |
| [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun) | `v2` → `v2.0.2` | release.yml | ✅ Available |
| [actions/cache](https://github.com/actions/cache) | `v4.1.0` → `v4.2.3` | ci.yml | ✅ Available |
```

### Table Features

- **Direct Links** - Action names link to their GitHub repositories
- **Version Changes** - Clear before/after version display
- **File Context** - Shows which workflow file contains the action
- **Status Indicators** - Availability and update status
- **Simplified Format** - Focused on essential information

## CLI Usage

### Scan for Action Updates

```bash
# Scan all dependencies including GitHub Actions
buddy-bot scan

# Verbose output showing action detection
buddy-bot scan --verbose

# Specific strategy for actions
buddy-bot scan --strategy minor
```

### Create Action Update PRs

```bash
# Create PRs including action updates
buddy-bot update

# Dry run to preview action updates
buddy-bot update --dry-run

# Assign action updates to specific team
buddy-bot update --assignee devops-team
```

## Best Practices

### Security Considerations

1. **Pin to specific versions** rather than using floating tags like `@main`
2. **Review action updates** for security implications
3. **Test workflow changes** in separate branches
4. **Monitor action dependencies** for deprecated actions

### Update Strategies

- **Patch updates**: Safe for most environments
- **Minor updates**: Review for new features
- **Major updates**: Test thoroughly for breaking changes
- **Security updates**: Prioritize and apply quickly
