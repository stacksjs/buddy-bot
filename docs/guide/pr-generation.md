# PR Generation

Buddy Bot creates beautifully formatted pull requests with comprehensive information about dependency updates.

## PR Structure

Each PR includes:

1. **Title** - Descriptive update summary
2. **Update Table** - All packages being updated
3. **Release Notes** - Changelogs and breaking changes
4. **Metadata** - Confidence metrics, age, adoption
5. **Rebase Checkbox** - Interactive update control
6. **Configuration Section** - Schedule and merge info

## PR Format by Ecosystem

### npm Dependencies

Full table with confidence badges:

```markdown
| Package | Change | Age | Adoption | Passing | Confidence |
|---------|--------|-----|----------|---------|------------|
| [typescript](https://www.typescriptlang.org/) | `^5.8.2` -> `^5.8.3` | ... | ... | ... | ... |
```

### PHP/Composer Dependencies

```markdown
| Package | Change | File | Status |
|---------|--------|------|--------|
| laravel/framework | ^10.0.0 -> ^10.16.0 | composer.json | Available |
```

### Zig Dependencies

```markdown
| Package | Change | Type | File |
|---------|--------|------|------|
| httpz | 0.5.0 -> 0.6.0 | minor | build.zig.zon |
```

### GitHub Actions

```markdown
| Action | Change | File | Status |
|--------|--------|------|--------|
| actions/checkout | v4 -> v4.2.2 | ci.yml | Available |
```

## Customizing PR Titles

Configure the title format:

```typescript
pullRequest: {
  titleFormat: 'chore(deps): {title}'
}
```

### Available Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{title}` | Generated title | "update typescript to 5.8.3" |
| `{package}` | Package name | "typescript" |
| `{from}` | Current version | "5.8.2" |
| `{to}` | New version | "5.8.3" |
| `{type}` | Update type | "patch" |

### Examples

```typescript
// Conventional commits style
titleFormat: 'chore(deps): {title}'
// Result: "chore(deps): update typescript to 5.8.3"

// Simple style
titleFormat: 'Update {package} to {to}'
// Result: "Update typescript to 5.8.3"

// With type
titleFormat: '[{type}] {title}'
// Result: "[patch] update typescript to 5.8.3"
```

## Customizing Commit Messages

```typescript
pullRequest: {
  commitMessageFormat: 'chore(deps): {message}'
}
```

## Labels

### Static Labels

Always applied to PRs:

```typescript
pullRequest: {
  labels: ['dependencies', 'automated']
}
```

### Dynamic Labels

Buddy Bot automatically adds contextual labels:

| Label | Condition |
|-------|-----------|
| `major-update` | Major version change |
| `minor-update` | Minor version change |
| `patch-update` | Patch version change |
| `security` | Security vulnerability fix |
| `npm` | npm package update |
| `github-actions` | Workflow update |

## Reviewers and Assignees

```typescript
pullRequest: {
  // Request reviews from these users
  reviewers: ['lead-dev', 'security-team'],

  // Assign PR to these users
  assignees: ['maintainer']
}
```

## Package Grouping

Group related packages into single PRs:

```typescript
packages: {
  groups: [
    {
      name: 'TypeScript Types',
      patterns: ['@types/*'],
      strategy: 'minor'
    },
    {
      name: 'Testing',
      patterns: ['vitest', '@vitest/*', 'happy-dom'],
      strategy: 'patch'
    }
  ]
}
```

### Group PR Title

```
chore(deps): update TypeScript Types (@types/node, @types/react, @types/bun)
```

## Auto-Merge

Automatically merge PRs that meet criteria:

```typescript
pullRequest: {
  autoMerge: {
    enabled: true,
    strategy: 'squash',
    conditions: ['patch-only']
  }
}
```

### Merge Strategies

| Strategy | Description |
|----------|-------------|
| `squash` | Squash commits (clean history) |
| `merge` | Create merge commit |
| `rebase` | Rebase and merge (linear) |

### Auto-Merge Conditions

| Condition | Description |
|-----------|-------------|
| `patch-only` | Only patch updates |
| `minor-and-patch` | Minor and patch updates |
| `all` | All updates (use cautiously) |

## Rebase Feature

Every PR includes a rebase checkbox:

```markdown
---
 - [ ] <!-- rebase-check -->If you want to update/retry this PR, check this box
---
```

### How It Works

1. Check the box in the PR description
2. `buddy-check.yml` workflow detects checked boxes
3. PR is automatically updated with latest versions
4. Checkbox is unchecked after successful update

### Manual Trigger

```bash
buddy-bot update-check --verbose
```

## Release Notes

Buddy Bot includes detailed release notes:

```markdown
### Release Notes

<details>
<summary>microsoft/TypeScript (typescript)</summary>

### [`v5.8.3`](https://github.com/microsoft/TypeScript/releases/tag/v5.8.3)

[Compare Source](https://github.com/microsoft/TypeScript/compare/v5.8.2...v5.8.3)

##### Bug Fixes
- Fix issue with module resolution
- Improve error messages

</details>
```

### Breaking Change Detection

Breaking changes are highlighted:

```markdown
### Breaking Changes

- TypeScript now requires Node.js 18+
- Deprecated API removed
```

## Confidence Metrics

PRs include Merge Confidence data:

| Metric | Description |
|--------|-------------|
| Age | How long the version has been available |
| Adoption | Percentage of users who upgraded |
| Passing | CI pass rate for this upgrade path |
| Confidence | Overall confidence score |

## PR Configuration Section

Each PR includes configuration info:

```markdown
### Configuration

Schedule: Branch creation - At any time, Automerge - At any time

Automerge: Disabled by config. Please merge manually.

Rebasing: Whenever PR is behind base branch.

Ignore: Close this PR to ignore this update.
```

## Dry Run

Preview PRs without creating them:

```bash
buddy-bot update --dry-run
```

Output shows:
- Packages to be updated
- PR titles that would be created
- Files that would be modified

## Programmatic Usage

Create PRs programmatically:

```typescript
import { Buddy, ConfigManager } from 'buddy-bot'

const config = await ConfigManager.loadConfig()
const buddy = new Buddy(config)

// Scan for updates
const scanResult = await buddy.scanForUpdates()
console.log(`Found ${scanResult.updates.length} updates`)

// Create PRs
if (scanResult.updates.length > 0) {
  await buddy.createPullRequests(scanResult)
}
```

## Next Steps

- Review [Configuration](/guide/configuration) options
- See [Usage Examples](/usage) for advanced patterns
