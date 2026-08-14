# Auto-Merge

Buddy Bot can merge its own dependency PRs without review once they qualify, so routine patch updates stop needing a human click.

## Enabling

```ts
// buddy-bot.config.ts
import type { BuddyBotConfig } from 'buddy-bot'

const config: BuddyBotConfig = {
  pullRequest: {
    autoMerge: {
      enabled: true,
      strategy: 'squash',
      conditions: ['patch-only'],
    },
  },
}

export default config
```

Auto-merge is **off** unless `enabled` is `true` *and* at least one condition is listed. An empty condition list merges nothing — the safe reading of a half-written config, rather than silently merging everything.

## Conditions

A PR qualifies when **any** listed condition accepts it.

| Condition | Merges when |
|---|---|
| `patch-only` | Every update in the PR is a patch bump |
| `minor-only` | Every update is minor or patch (no majors) |
| `security-only` | The PR carries the configured `security.label` |
| `all` | Any Buddy Bot PR, including major upgrades |

Unknown condition names are rejected by config validation rather than ignored, so a typo like `patch_only` fails loudly instead of widening what merges unreviewed.

Update types are read from the metadata manifest embedded in each PR body, not from the PR title. A retitled or hand-edited PR therefore cannot talk its way past a `patch-only` policy. A PR whose manifest is missing (opened before manifests existed) or truncated (a very large group whose manifest had to drop rows) is never auto-merged, because neither case proves what the PR actually changes.

## How it merges

Two mechanisms, picked automatically:

1. **GitHub's own auto-merge queue** — used when the PR is created. GitHub waits for required checks and merges without another workflow run. This needs auto-merge enabled on the repository and at least one required check via branch protection.
2. **Direct merge during `update-check`** — repositories without required checks cannot use the queue, so `buddy-bot update-check` re-evaluates open PRs once their checks have reported and merges the ones that pass.

Nothing is required of you to choose between them: if GitHub refuses to queue a PR, `update-check` picks it up on its next run.

```bash
buddy-bot update-check --dry-run --verbose
```

`--dry-run` reports what would merge and why, without merging.

## Safety rails

A PR is skipped when any of these hold:

- it wasn't opened by Buddy Bot (branch not under `buddy-bot/`)
- it is a draft
- it carries the opt-out label (`no-auto-merge` by default)
- its checks are failing or still running, unless `requireGreenCI` is off
- its manifest is missing or truncated

A repository with **no** checks at all is treated as having nothing to wait for, so `requireGreenCI` does not block merges there.

## Options

| Option | Type | Description | Default |
|---|---|---|---|
| `enabled` | `boolean` | Turn auto-merge on | `false` |
| `strategy` | `'merge' \| 'squash' \| 'rebase'` | Merge method | `'squash'` |
| `conditions` | `string[]` | Which updates qualify (see table above) | `[]` (nothing merges) |
| `requireGreenCI` | `boolean` | Require passing checks before a direct merge | `true` |
| `optOutLabel` | `string` | Label that suppresses auto-merge on a PR | `'no-auto-merge'` |

## Opting a single PR out

Add the opt-out label to any PR you want to review by hand:

```bash
gh pr edit 123 --add-label no-auto-merge
```

## Permissions

The token needs `contents: write` and `pull-requests: write`. To let GitHub queue merges itself, enable **Allow auto-merge** in repository settings and require at least one status check on the base branch.
