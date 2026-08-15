import type { FileChange, Issue, IssueOptions, PullRequest, PullRequestOptions } from '../types'
import type { Logger } from '../utils/logger'
import type {
  GitProvider,
  ProviderBranch,
  ProviderCapabilities,
  ReviewSubmission,
  ReviewSubmissionResult,
} from './provider'
import { formatError } from '../utils/errors'
import { fetchWithTimeout } from '../utils/http'
import { getDefaultLogger } from '../utils/logger'

/** GitLab's merge request, as much of it as buddy-bot reads. */
interface GitLabMergeRequest {
  iid: number
  title: string
  description: string | null
  source_branch: string
  target_branch: string
  state: string
  web_url: string
  created_at: string
  updated_at: string
  merged_at: string | null
  draft?: boolean
  work_in_progress?: boolean
  sha?: string
  author?: { username: string }
  reviewers?: Array<{ username: string }>
  assignees?: Array<{ username: string }>
  labels?: string[]
}

/** GitLab's issue. */
interface GitLabIssue {
  iid: number
  title: string
  description: string | null
  state: string
  web_url: string
  created_at: string
  updated_at: string
  closed_at: string | null
  author?: { username: string }
  assignees?: Array<{ username: string }>
  labels?: string[]
}

/** A branch as GitLab reports it. */
interface GitLabBranch {
  name: string
  commit?: { id: string, committed_date: string }
}

/**
 * GitLab, through the v4 REST API.
 *
 * Terminology is translated at this boundary rather than threaded through the
 * codebase: a merge request is a `PullRequest`, and its `iid` — the
 * project-scoped number a user sees — is the `number`. GitLab also has a
 * global `id`, which is *not* the number in the URL; using it would address
 * the wrong merge request on every project but the first.
 *
 * @example
 * ```ts
 * const provider = new GitLabProvider(token, 'group/sub', 'repo')
 * const mrs = await provider.getPullRequests('open')
 * ```
 */
export class GitLabProvider implements GitProvider {
  private readonly apiUrl: string
  private readonly logger: Logger

  /** URL-encoded project path, which is how v4 addresses a project. */
  private readonly projectId: string

  constructor(
    private readonly token: string,
    owner: string,
    repo: string,
    apiUrl?: string,
    logger?: Logger,
  ) {
    this.apiUrl = (apiUrl ?? 'https://gitlab.com/api/v4').replace(/\/+$/, '')
    this.logger = logger ?? getDefaultLogger()
    // A group path may contain slashes (`group/subgroup/repo`), so the whole
    // path is encoded as one segment rather than joined into the URL.
    this.projectId = encodeURIComponent(`${owner}/${repo}`)
  }

  capabilities(): ProviderCapabilities {
    return {
      // GitLab has no issue pinning at all.
      pinIssues: false,
      // Commit statuses are the closest analogue and are what `createCheckRun`
      // maps onto.
      checkRuns: true,
      inlineReviewComments: true,
      reviewSuggestions: true,
      // Merge-when-pipeline-succeeds.
      nativeAutoMerge: true,
      commentReactions: true,
      ciLogs: true,
      teamReviewers: false,
      draftPullRequests: true,
      permissionLookup: true,
      branchHousekeeping: true,
      reopenPullRequests: true,
      labels: true,
    }
  }

  // -- Transport -----------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { raw?: boolean } = {},
  ): Promise<T> {
    const response = await fetchWithTimeout(`${this.apiUrl}${path}`, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Accept': options.raw ? 'text/plain' : 'application/json',
        'User-Agent': 'buddy-bot',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`GitLab ${method} ${path} failed: ${response.status} ${detail.slice(0, 200)}`)
    }

    const text = await response.text()

    // An empty body is a successful response with nothing to say — a 204 from
    // a delete, a 201 from a write endpoint. Parsing it as JSON would make
    // every one of those throw on success.
    if (options.raw)
      return text as T

    return (text.trim() ? JSON.parse(text) : undefined) as T
  }

  /** A request whose 404 is an answer rather than an error. */
  private async optional<T>(method: string, path: string): Promise<T | null> {
    try {
      return await this.request<T>(method, path)
    }
    catch (error) {
      if (String(error).includes('404'))
        return null
      throw error
    }
  }

  // -- Branches ------------------------------------------------------------

  async branchExists(branchName: string): Promise<boolean> {
    const branch = await this.optional<GitLabBranch>(
      'GET',
      `/projects/${this.projectId}/repository/branches/${encodeURIComponent(branchName)}`,
    )

    return branch !== null
  }

  async createBranch(branchName: string, baseBranch: string): Promise<void> {
    await this.request('POST', `/projects/${this.projectId}/repository/branches`, {
      branch: branchName,
      ref: baseBranch,
    })
  }

  async deleteBranch(branchName: string): Promise<void> {
    await this.request(
      'DELETE',
      `/projects/${this.projectId}/repository/branches/${encodeURIComponent(branchName)}`,
    )
  }

  async commitChanges(
    branchName: string,
    message: string,
    files: FileChange[],
    baseBranch: string = 'main',
  ): Promise<void> {
    if (files.length === 0)
      return

    const exists = await this.branchExists(branchName)

    // Reset-then-apply, matching the other providers: a re-run produces the
    // same tree rather than stacking fixups on the previous attempt.
    if (exists)
      await this.deleteBranch(branchName)

    await this.createBranch(branchName, baseBranch)

    // Each action needs to say whether it creates or updates, and GitLab
    // rejects the whole commit if one is wrong — so existence is resolved
    // against the base rather than assumed from the caller's `type`.
    const actions = await Promise.all(files.map(async (file) => {
      if (file.type === 'delete')
        return { action: 'delete', file_path: file.path }

      const present = await this.getFileContent(file.path, baseBranch) !== null

      return {
        action: present ? 'update' : 'create',
        file_path: file.path,
        content: file.content,
      }
    }))

    await this.request('POST', `/projects/${this.projectId}/repository/commits`, {
      branch: branchName,
      commit_message: message,
      actions,
    })
  }

  async getFileContent(path: string, ref: string): Promise<string | null> {
    const file = await this.optional<{ content?: string, encoding?: string }>(
      'GET',
      `/projects/${this.projectId}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    )

    if (!file?.content)
      return null

    return file.encoding === 'base64'
      ? Buffer.from(file.content, 'base64').toString('utf-8')
      : file.content
  }

  // -- Merge requests ------------------------------------------------------

  async createPullRequest(options: PullRequestOptions): Promise<PullRequest> {
    const created = await this.request<GitLabMergeRequest>(
      'POST',
      `/projects/${this.projectId}/merge_requests`,
      {
        source_branch: options.head,
        target_branch: options.base,
        // GitLab marks a draft by prefixing the title, not with a flag.
        title: options.draft ? `Draft: ${options.title}` : options.title,
        description: options.body,
        ...(options.labels?.length ? { labels: options.labels.join(',') } : {}),
        remove_source_branch: true,
      },
    )

    // Reviewers and assignees take user IDs, not usernames, so each is
    // resolved separately and a failure to resolve one is not fatal — a merge
    // request without a reviewer is still a merge request.
    await this.assignPeople(created.iid, options)

    return this.toPullRequest(created)
  }

  private async assignPeople(iid: number, options: PullRequestOptions): Promise<void> {
    const resolve = async (usernames: string[] = []): Promise<number[]> => {
      const ids = await Promise.all(usernames.map(async (username) => {
        const users = await this.optional<Array<{ id: number }>>(
          'GET',
          `/users?username=${encodeURIComponent(username)}`,
        )
        return users?.[0]?.id ?? null
      }))

      return ids.filter((id): id is number => id !== null)
    }

    const [reviewerIds, assigneeIds] = await Promise.all([
      resolve(options.reviewers),
      resolve(options.assignees),
    ])

    if (reviewerIds.length === 0 && assigneeIds.length === 0)
      return

    try {
      await this.request('PUT', `/projects/${this.projectId}/merge_requests/${iid}`, {
        ...(reviewerIds.length ? { reviewer_ids: reviewerIds } : {}),
        ...(assigneeIds.length ? { assignee_ids: assigneeIds } : {}),
      })
    }
    catch (error) {
      this.logger.warn(`⚠️ Could not assign reviewers on !${iid}: ${formatError(error)}`)
    }
  }

  async getPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
    // GitLab splits closed and merged into distinct states, so "closed" for
    // buddy-bot means both — a merged merge request is not open.
    const query = state === 'all'
      ? 'state=all'
      : state === 'open'
        ? 'state=opened'
        : 'state=all'

    const all = await this.request<GitLabMergeRequest[]>(
      'GET',
      `/projects/${this.projectId}/merge_requests?${query}&per_page=100`,
    )

    const mapped = all.map(mr => this.toPullRequest(mr))

    return state === 'closed' ? mapped.filter(pr => pr.state !== 'open') : mapped
  }

  async updatePullRequest(prNumber: number, options: Partial<PullRequestOptions>): Promise<PullRequest> {
    const updated = await this.request<GitLabMergeRequest>(
      'PUT',
      `/projects/${this.projectId}/merge_requests/${prNumber}`,
      {
        ...(options.title !== undefined
          ? { title: options.draft ? `Draft: ${options.title}` : options.title }
          : {}),
        ...(options.body !== undefined ? { description: options.body } : {}),
        ...(options.base !== undefined ? { target_branch: options.base } : {}),
        ...(options.labels !== undefined ? { labels: options.labels.join(',') } : {}),
      },
    )

    return this.toPullRequest(updated)
  }

  async closePullRequest(prNumber: number): Promise<void> {
    await this.request('PUT', `/projects/${this.projectId}/merge_requests/${prNumber}`, {
      state_event: 'close',
    })
  }

  async reopenPullRequest(prNumber: number): Promise<void> {
    await this.request('PUT', `/projects/${this.projectId}/merge_requests/${prNumber}`, {
      state_event: 'reopen',
    })
  }

  async mergePullRequest(
    prNumber: number,
    strategy: 'merge' | 'squash' | 'rebase' = 'squash',
  ): Promise<void> {
    await this.request('PUT', `/projects/${this.projectId}/merge_requests/${prNumber}/merge`, {
      squash: strategy === 'squash',
      should_remove_source_branch: true,
    })
  }

  async getPullRequestDiff(prNumber: number): Promise<string> {
    const changes = await this.request<{ changes?: Array<{ old_path: string, new_path: string, diff: string }> }>(
      'GET',
      `/projects/${this.projectId}/merge_requests/${prNumber}/changes`,
    )

    // GitLab returns per-file hunks without the `diff --git` headers a unified
    // diff parser expects, so they are reconstructed here rather than in the
    // parser — every other provider hands over a real unified diff.
    return (changes.changes ?? [])
      .map(change => [
        `diff --git a/${change.old_path} b/${change.new_path}`,
        `--- a/${change.old_path}`,
        `+++ b/${change.new_path}`,
        change.diff.replace(/\n$/, ''),
      ].join('\n'))
      .join('\n')
  }

  async getPullRequestHeadSha(prNumber: number): Promise<string> {
    const mr = await this.request<GitLabMergeRequest>(
      'GET',
      `/projects/${this.projectId}/merge_requests/${prNumber}`,
    )

    return mr.sha ?? ''
  }

  async createComment(prNumber: number, comment: string): Promise<void> {
    // Issues and merge requests have separate note endpoints and share a
    // number space only by coincidence. The merge request is tried first
    // because that is what callers mean far more often.
    try {
      await this.request('POST', `/projects/${this.projectId}/merge_requests/${prNumber}/notes`, {
        body: comment,
      })
    }
    catch (error) {
      if (!String(error).includes('404'))
        throw error

      await this.request('POST', `/projects/${this.projectId}/issues/${prNumber}/notes`, {
        body: comment,
      })
    }
  }

  // -- Issues --------------------------------------------------------------

  async createIssue(options: IssueOptions): Promise<Issue> {
    const created = await this.request<GitLabIssue>('POST', `/projects/${this.projectId}/issues`, {
      title: options.title,
      description: options.body,
      ...(options.labels?.length ? { labels: options.labels.join(',') } : {}),
    })

    return this.toIssue(created)
  }

  async getIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
    const query = state === 'all' ? 'state=all' : `state=${state === 'open' ? 'opened' : 'closed'}`

    const issues = await this.request<GitLabIssue[]>(
      'GET',
      `/projects/${this.projectId}/issues?${query}&per_page=100`,
    )

    return issues.map(issue => this.toIssue(issue))
  }

  async updateIssue(issueNumber: number, options: Partial<IssueOptions>): Promise<Issue> {
    const updated = await this.request<GitLabIssue>(
      'PUT',
      `/projects/${this.projectId}/issues/${issueNumber}`,
      {
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.body !== undefined ? { description: options.body } : {}),
        ...(options.labels !== undefined ? { labels: options.labels.join(',') } : {}),
      },
    )

    return this.toIssue(updated)
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.request('PUT', `/projects/${this.projectId}/issues/${issueNumber}`, {
      state_event: 'close',
    })
  }

  async unpinIssue(_issueNumber: number): Promise<boolean> {
    // GitLab has no issue pinning. Reported rather than thrown, because
    // cleanup calls this unconditionally.
    return false
  }

  // -- Capability-gated ----------------------------------------------------

  async enableAutoMerge(
    prNumber: number,
    strategy: 'merge' | 'squash' | 'rebase' = 'squash',
  ): Promise<boolean> {
    try {
      await this.request('PUT', `/projects/${this.projectId}/merge_requests/${prNumber}/merge`, {
        merge_when_pipeline_succeeds: true,
        squash: strategy === 'squash',
        should_remove_source_branch: true,
      })
      return true
    }
    catch (error) {
      // A project with no pipeline cannot queue a merge; the caller falls back
      // to merging directly once checks pass.
      this.logger.debug(`Could not queue !${prNumber} for auto-merge: ${formatError(error)}`)
      return false
    }
  }

  async getPullRequestChecksState(prNumber: number): Promise<'success' | 'failure' | 'pending' | 'none'> {
    const pipelines = await this.optional<Array<{ status: string }>>(
      'GET',
      `/projects/${this.projectId}/merge_requests/${prNumber}/pipelines`,
    )

    const latest = pipelines?.[0]?.status
    if (!latest)
      return 'none'

    if (latest === 'success')
      return 'success'
    if (['failed', 'canceled'].includes(latest))
      return 'failure'
    // `skipped` and `manual` are neither pass nor fail; treating them as
    // success would merge on a pipeline nobody ran.
    if (['running', 'pending', 'created', 'waiting_for_resource', 'preparing', 'scheduled'].includes(latest))
      return 'pending'

    return 'none'
  }

  async createReview(prNumber: number, review: ReviewSubmission): Promise<ReviewSubmissionResult> {
    // GitLab has no review object: the body is a note, and inline comments are
    // discussions with position data. Posting the body first means a failure
    // to place an inline comment still leaves the review readable.
    await this.request('POST', `/projects/${this.projectId}/merge_requests/${prNumber}/notes`, {
      body: review.body,
    })

    if (!review.comments?.length)
      return { posted: true, inlineComments: 0 }

    const versions = await this.optional<Array<{
      head_commit_sha: string
      base_commit_sha: string
      start_commit_sha: string
    }>>('GET', `/projects/${this.projectId}/merge_requests/${prNumber}/versions`)

    const version = versions?.[0]
    if (!version) {
      this.logger.warn('⚠️ Could not resolve diff positions; inline comments were not posted')
      return { posted: true, inlineComments: 0 }
    }

    let placed = 0

    for (const comment of review.comments) {
      try {
        await this.request('POST', `/projects/${this.projectId}/merge_requests/${prNumber}/discussions`, {
          body: comment.body,
          position: {
            position_type: 'text',
            base_sha: version.base_commit_sha,
            start_sha: version.start_commit_sha,
            head_sha: version.head_commit_sha,
            new_path: comment.path,
            old_path: comment.path,
            ...(comment.side === 'RIGHT' ? { new_line: comment.line } : { old_line: comment.line }),
          },
        })
        placed++
      }
      catch (error) {
        // A position GitLab rejects is one that does not exist in the diff;
        // dropping that comment is better than failing the whole review.
        this.logger.debug(`Could not place a comment on ${comment.path}:${comment.line}: ${formatError(error)}`)
      }
    }

    return { posted: true, inlineComments: placed }
  }

  async createCheckRun(
    name: string,
    headSha: string,
    result: { conclusion: 'success' | 'failure' | 'neutral', title: string, summary: string },
  ): Promise<void> {
    try {
      await this.request('POST', `/projects/${this.projectId}/statuses/${headSha}`, {
        state: result.conclusion === 'failure' ? 'failed' : 'success',
        name,
        description: result.title.slice(0, 140),
      })
    }
    catch (error) {
      // Commit statuses need `api` scope, which a CI job token may lack; a
      // missing gate result must not fail the run that produced it.
      this.logger.warn(`⚠️ Could not report status ${name}: ${formatError(error)}`)
    }
  }

  async reactToComment(commentId: number, reaction: 'eyes' | '+1' | '-1' | 'rocket' | 'confused'): Promise<void> {
    const emoji: Record<string, string> = {
      'eyes': 'eyes',
      '+1': 'thumbsup',
      '-1': 'thumbsdown',
      'rocket': 'rocket',
      'confused': 'confused',
    }

    try {
      await this.request('POST', `/projects/${this.projectId}/notes/${commentId}/award_emoji`, {
        name: emoji[reaction] ?? 'eyes',
      })
    }
    catch (error) {
      this.logger.debug(`Could not react to note ${commentId}: ${formatError(error)}`)
    }
  }

  async hasWriteAccess(username: string): Promise<boolean> {
    const members = await this.optional<Array<{ username: string, access_level: number }>>(
      'GET',
      `/projects/${this.projectId}/members/all?query=${encodeURIComponent(username)}`,
    )

    // 30 is Developer — the level at which a user can push. Anything below
    // that is Reporter or Guest, who cannot.
    return (members ?? []).some(member => member.username === username && member.access_level >= 30)
  }

  async getWorkflowRunLogs(runId: number): Promise<string | null> {
    return this.optional<string>('GET', `/projects/${this.projectId}/jobs/${runId}/trace`)
      .catch(() => null)
  }

  // -- Housekeeping --------------------------------------------------------

  async getBuddyBotBranches(): Promise<ProviderBranch[]> {
    const branches = await this.request<GitLabBranch[]>(
      'GET',
      `/projects/${this.projectId}/repository/branches?search=buddy-bot&per_page=100`,
    )

    return branches
      .filter(branch => branch.name.startsWith('buddy-bot/'))
      .map(branch => ({
        name: branch.name,
        sha: branch.commit?.id ?? '',
        lastCommitDate: branch.commit?.committed_date
          ? new Date(branch.commit.committed_date)
          : new Date(0),
      }))
  }

  async getOrphanedBuddyBotBranches(): Promise<ProviderBranch[]> {
    const [branches, open] = await Promise.all([
      this.getBuddyBotBranches(),
      this.getPullRequests('open'),
    ])

    const claimed = new Set(open.map(pr => pr.head))

    return branches.filter(branch => !claimed.has(branch.name))
  }

  async cleanupStaleBranches(
    olderThanDays: number = 7,
    dryRun: boolean = false,
  ): Promise<{ deleted: string[], failed: string[] }> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    const stale = (await this.getOrphanedBuddyBotBranches())
      .filter(branch => branch.lastCommitDate < cutoff)

    if (dryRun)
      return { deleted: stale.map(branch => branch.name), failed: [] }

    const deleted: string[] = []
    const failed: string[] = []

    for (const branch of stale) {
      try {
        await this.deleteBranch(branch.name)
        deleted.push(branch.name)
      }
      catch {
        failed.push(branch.name)
      }
    }

    return { deleted, failed }
  }

  // -- Translation ---------------------------------------------------------

  private toPullRequest(mr: GitLabMergeRequest): PullRequest {
    const isDraft = Boolean(mr.draft ?? mr.work_in_progress) || /^(?:draft|wip):/i.test(mr.title)

    return {
      number: mr.iid,
      // The draft prefix is GitLab's marker, not part of the title a caller
      // set; returning it would make an update round-trip grow `Draft: Draft:`.
      title: mr.title.replace(/^(?:draft|wip):\s*/i, ''),
      body: mr.description ?? '',
      head: mr.source_branch,
      base: mr.target_branch,
      state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed',
      url: mr.web_url,
      createdAt: new Date(mr.created_at),
      updatedAt: new Date(mr.updated_at),
      ...(mr.merged_at ? { mergedAt: new Date(mr.merged_at) } : {}),
      author: mr.author?.username ?? '',
      reviewers: (mr.reviewers ?? []).map(user => user.username),
      assignees: (mr.assignees ?? []).map(user => user.username),
      labels: mr.labels ?? [],
      draft: isDraft,
    }
  }

  private toIssue(issue: GitLabIssue): Issue {
    return {
      number: issue.iid,
      title: issue.title,
      body: issue.description ?? '',
      state: issue.state === 'closed' ? 'closed' : 'open',
      url: issue.web_url,
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      ...(issue.closed_at ? { closedAt: new Date(issue.closed_at) } : {}),
      author: issue.author?.username ?? '',
      assignees: (issue.assignees ?? []).map(user => user.username),
      labels: issue.labels ?? [],
    }
  }
}
