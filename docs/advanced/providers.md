# Git Providers

Buddy Bot talks to a hosting platform through one interface, `GitProvider`.
GitHub is the only implementation today; GitLab ([#115]) and Bitbucket ([#116])
are tracked separately. This page describes the contract so adding one is
mechanical rather than exploratory.

## Configuration

```ts
const config: BuddyBotConfig = {
  repository: {
    provider: 'github', // 'gitlab' and 'bitbucket' type-check but are rejected
    owner: 'stacksjs',
    name: 'buddy-bot',
    // Self-hosted instances: point at the API root
    apiUrl: 'https://github.acme.com/api/v3',
  },
}
```

Naming an unimplemented provider fails validation before any network or git
work happens, with a link to the issue tracking it:

```
repository.provider: "gitlab" support is not implemented yet — follow
https://github.com/stacksjs/buddy-bot/issues/115
```

## Tokens

Tokens are resolved from the environment by provider convention. Buddy Bot
never reads a token from configuration files by default — pass one explicitly
with `repository.token` if you have a reason to.

| Provider  | Variables, in order                                |
| --------- | -------------------------------------------------- |
| GitHub    | `GITHUB_TOKEN`, `BUDDY_BOT_TOKEN`                  |
| GitLab    | `CI_JOB_TOKEN`, `GITLAB_TOKEN`, `BUDDY_BOT_TOKEN`  |
| Bitbucket | `BITBUCKET_TOKEN`, `BUDDY_BOT_TOKEN`               |

The ambient CI token comes first on purpose. On GitHub it attributes pull
requests to `github-actions[bot]` rather than to a maintainer's personal
token. `BUDDY_BOT_TOKEN` is not a "better" `GITHUB_TOKEN` — it is passed
*separately* as the workflow token, supplying the elevated `workflow` scope
needed to write files under `.github/workflows/`. A run with only
`GITHUB_TOKEN` works fine; it just skips workflow-file updates and says so.

## Capabilities

Buddy Bot's feature surface is wider than any single platform's API, so
features degrade against declared capabilities rather than assuming GitHub:

```ts
import { supports } from 'buddy-bot'

if (supports(provider, 'pinIssues', 'pinIssue'))
  await provider.pinIssue(dashboard.number)
```

| Capability             | Gates                                        |
| ---------------------- | -------------------------------------------- |
| `pinIssues`            | `pinIssue`                                   |
| `checkRuns`            | `createCheckRun`                             |
| `inlineReviewComments` | `createReview` with line-anchored comments   |
| `reviewSuggestions`    | ` ```suggestion ` blocks in review comments  |
| `nativeAutoMerge`      | `enableAutoMerge`                            |
| `commentReactions`     | `reactToComment`                             |
| `ciLogs`               | `getWorkflowRunLogs`                         |
| `teamReviewers`        | Requesting review from a team                |
| `draftPullRequests`    | Opening a pull request as a draft            |
| `permissionLookup`     | `hasWriteAccess`                             |
| `branchHousekeeping`   | `getBuddyBotBranches`, `cleanupStaleBranches` |

`supports()` checks both the flag and the method's presence, so a provider
that declares a capability it did not implement is treated as not having it
rather than producing a `TypeError` at the call site.

Where a capability *is* the command — `buddy-bot cleanup` on a provider that
cannot enumerate branches — use `assertSupports()` instead. There is nothing
to degrade to, and a clear reason beats a silent success.

## Adding a provider

1. **Implement `GitProvider`** in `src/git/<name>-provider.ts`. The required
   members are the ones every platform has; the optional ones are gated by
   capabilities. Declare only what you actually implement.

2. **Pass the conformance suite.** `test/git/provider-conformance.ts` is the
   behavioural contract — it tests what callers are entitled to assume, never
   URL shapes or status codes, so it runs against a live client with recorded
   fixtures or an in-memory fake:

   ```ts
   import { runProviderConformance } from './git/provider-conformance'

   runProviderConformance('gitlab', () => new GitLabProvider(/* … */))
   ```

   `test/git/in-memory-provider.ts` is a complete reference implementation to
   read alongside it.

3. **Register it** in `IMPLEMENTED_PROVIDERS` and add the factory branch in
   `createProvider()`.

4. **Add CI templates.** `src/setup.ts` generates GitHub Actions workflows;
   a new provider needs its own pipeline format.

### Terminology

The core vocabulary is neutral where it can be and GitHub-shaped where the
concepts genuinely differ. A GitLab merge request is a `PullRequest` at the
interface boundary — translate at the provider edge rather than threading two
vocabularies through the codebase.

Web and API URLs are constructed inside the provider. A test asserts that
`github.com` appears only in files where the platform is genuinely the subject
(the GitHub provider, workflow generation, and release-note fetching, which
reads *dependency* repositories and is GitHub-centric regardless of where your
own repository lives).

[#115]: https://github.com/stacksjs/buddy-bot/issues/115
[#116]: https://github.com/stacksjs/buddy-bot/issues/116
