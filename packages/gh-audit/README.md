# @stacksjs/gh-audit

Static analysis for GitHub Actions workflows. Catches the supply-chain footguns that put repos at risk: unpinned third-party actions, excessive token permissions, `pull_request_target` traps, `${{ }}` shell injection, missing job timeouts, exposed self-hosted runners.

Built standalone — call it from CI directly, or let `buddy-bot security` run it for you.

## Why

Worm-class supply-chain attacks (Shai-Hulud and friends) exploit predictable misconfigurations: a GitHub Action pinned to a moving tag, a workflow that grants `permissions: write-all`, a `run:` block that interpolates `${{ github.event.pull_request.title }}` into a shell. Each one of these is a finding here.

Six rules ship by default, all focused on supply-chain hardening:

| Rule | Severity | What it catches |
|---|---|---|
| `unpinned-action` | warning | Third-party `uses:` references on a tag/branch instead of a SHA |
| `excessive-permissions` | warning + error | Missing top-level `permissions`, `write-all`, risky `id-token: write` / `actions: write` |
| `dangerous-pull-request-target` | error | `pull_request_target` workflows that check out PR-author code |
| `bash-injection` | error | Untrusted `${{ ... }}` interpolated into `run:` blocks |
| `missing-timeout` | warning | Jobs without an explicit `timeout-minutes` |
| `self-hosted-exposure` | warning | `runs-on: self-hosted` without scoping labels |

`error`-severity findings cause a non-zero exit, so the tool slots straight into a CI gate.

## Install

Standalone:

```bash
bunx --bun @stacksjs/gh-audit
```

Or as part of `buddy-bot setup` — the security workflow gets generated alongside the dependency-update one.

## Usage

```bash
# Scan the current repo (.github/workflows/*.yml)
gh-audit

# Scan a different repo
gh-audit ../other-repo

# Machine-readable output
gh-audit --format json

# GitHub Actions inline annotations (auto-detected on a runner)
gh-audit --format github

# Skip a noisy rule
gh-audit --ignore missing-timeout

# Disable colour
gh-audit --no-color
```

## In a workflow

```yaml
name: GH Actions Security Audit

on:
  push:
    branches: [main]
    paths: ['.github/workflows/**']
  pull_request:
    paths: ['.github/workflows/**']
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bunx --bun @stacksjs/gh-audit
```

## Programmatic API

```ts
import { audit } from '@stacksjs/gh-audit'

const result = await audit('.', { ignore: ['missing-timeout'] })
if (result.failed) {
  for (const f of result.findings) {
    console.error(`${f.file}:${f.line ?? '?'} ${f.severity} ${f.message}`)
  }
  process.exit(1)
}
```

## Output formats

- `pretty` (default off-runner) — colored, grouped by file
- `github` (default on-runner) — `::error file=…,line=…::msg` workflow commands → inline PR annotations
- `json` — machine-readable, shape:

```jsonc
{
  "ok": false,
  "summary": { "workflows": 3, "findings": 58, "errors": 33, "warnings": 25, "info": 0 },
  "findings": [
    {
      "ruleId": "bash-injection",
      "severity": "error",
      "message": "Job `build`, step 2: `github.event.pull_request.title` is interpolated into a shell.",
      "file": ".github/workflows/ci.yml",
      "line": 42,
      "fix": "Put the value in `env:` and reference it with `\"$NAME\"` instead."
    }
  ]
}
```

## Relationship to zizmor

Inspiration only. [zizmor](https://github.com/zizmorcore/zizmor) is a Rust-based GH Actions linter with a broader rule catalog. We focus on a tight, supply-chain-first ruleset implemented in TypeScript so it slots into Bun-native projects without a foreign-tool dependency. Both tools defend the same surface — pick whichever fits your stack.

## License

MIT.
