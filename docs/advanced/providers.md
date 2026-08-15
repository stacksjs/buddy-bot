# Git Providers

Buddy Bot talks to a hosting platform through one interface, `GitProvider`.
GitHub, GitLab and Bitbucket Cloud are all implemented. This page describes the
contract so adding another is mechanical rather than exploratory.

## Configuration

```ts
const config: BuddyBotConfig = {
  repository: {
    provider: 'gitlab',
    // GitLab: the full group path, subgroups included
    owner: 'group/subgroup',
    name: 'repo',
    // Self-hosted instances: point at the API root
    apiUrl: 'https://gitlab.acme.com/api/v4',
  },
}
```

`owner` means the workspace on Bitbucket and the group path on GitLab, where it
may contain slashes — those are part of the project's name, not the URL, and
the provider encodes them as one segment.

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
| `reopenPullRequests`   | `reopenPullRequest`                          |
| `labels`               | Labels on pull requests and issues           |

### What each platform supports

| Capability             | GitHub | GitLab | Bitbucket |
| ---------------------- | ------ | ------ | --------- |
| `pinIssues`            | ✅     | ❌     | ❌        |
| `checkRuns`            | ✅     | ✅ (commit statuses) | ✅ (build statuses) |
| `inlineReviewComments` | ✅     | ✅     | ✅        |
| `reviewSuggestions`    | ✅     | ✅     | ❌        |
| `nativeAutoMerge`      | ✅     | ✅ (merge when pipeline succeeds) | ❌ |
| `commentReactions`     | ✅     | ✅ (award emoji) | ❌  |
| `ciLogs`               | ✅     | ✅     | ❌        |
| `teamReviewers`        | ✅     | ❌     | ❌        |
| `draftPullRequests`    | ✅     | ✅ (title prefix) | ❌ |
| `permissionLookup`     | ✅     | ✅     | ✅        |
| `branchHousekeeping`   | ✅     | ✅     | ✅        |
| `reopenPullRequests`   | ✅     | ✅     | ❌        |
| `labels`               | ✅     | ✅     | ❌        |

Two of these rows exist *because* Bitbucket forced the distinction. A declined
Bitbucket pull request is final — there is no reopen — and Bitbucket has no
labels on pull requests or issues at all. Rather than have those operations
silently do nothing, they are capabilities: `reopenPullRequest` is absent from
the Bitbucket provider entirely, so a caller that gates on the flag degrades
and a caller that does not gets a `TypeError` at the point of the mistake.

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
   `src/templates/gitlab-ci.ts` generates GitLab and Bitbucket pipelines.

`test/git/fake-api.ts` is worth reading before writing a new one: it serves an
in-memory repository in each platform's REST dialect, so the *real* provider
class runs through the conformance suite. That tests the actual HTTP mapping —
URL shapes, field names, state vocabularies — which is the half most likely to
be wrong. Two genuine bugs in the GitLab and Bitbucket providers were caught
that way: a `DELETE` returning an empty body being parsed as JSON, and
Bitbucket returning file contents as plain text rather than JSON.

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

## CI schedules

Neither GitLab nor Bitbucket lets a repository file declare a schedule — both
configure them in the project UI. The generated pipelines therefore branch on a
variable the schedule sets, and carry instructions for creating those
schedules. A generated file that assumed a `schedule:` block would never run
and give no clue why.

**GitLab** — Settings → CI/CD → Pipeline schedules. Create two, with variables
`BUDDY_JOB=update` and `BUDDY_JOB=dashboard`.

**Bitbucket** — Repository settings → Pipelines → Schedules, pointed at the
`buddy-update` and `buddy-dashboard` custom pipelines.

On GitLab, set `GITLAB_TOKEN` with `api` scope: the ambient `CI_JOB_TOKEN`
cannot open merge requests, which is the failure a first scheduled run would
otherwise hit.
