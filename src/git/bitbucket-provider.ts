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

/** Bitbucket's pull request, as much of it as buddy-bot reads. */
interface BitbucketPullRequest {
  id: number
  title: string
  description?: string
  source?: { branch?: { name?: string }, commit?: { hash?: string } }
  destination?: { branch?: { name?: string } }
  state: string
  links?: { html?: { href?: string } }
  created_on: string
  updated_on: string
  author?: { nickname?: string, display_name?: string }
  reviewers?: Array<{ nickname?: string, display_name?: string }>
}

/** Bitbucket's issue, from the optional issue tracker. */
interface BitbucketIssue {
  id: number
  title: string
  content?: { raw?: string }
  state: string
  links?: { html?: { href?: string } }
  created_on: string
  updated_on: string
  reporter?: { nickname?: string, display_name?: string }
  kind?: string
}

/** A paginated Bitbucket response. */
interface Paged<T> {
  values?: T[]
  next?: string
}

/**
 * Bitbucket Cloud, through the 2.0 REST API.
 *
 * The most capability-constrained provider, and deliberately honest about it:
 * Bitbucket has no check runs, no merge queue, no issue pinning and no
 * reactions. Those flags are `false`, and every call site already gates on
 * them — a feature that cannot work here degrades with a note rather than
 * failing halfway through a run.
 *
 * Its issue tracker is also optional per repository, so issue operations may
 * legitimately 404 on a repository that is otherwise fine.
 *
 * @example
 * ```ts
 * const provider = new BitbucketProvider(token, 'workspace', 'repo')
 * ```
 */
export class BitbucketProvider implements GitProvider {
  private readonly apiUrl: string
  private readonly logger: Logger
  private readonly slug: string

  constructor(
    private readonly token: string,
    workspace: string,
    repo: string,
    apiUrl?: string,
    logger?: Logger,
  ) {
    this.apiUrl = (apiUrl ?? 'https://api.bitbucket.org/2.0').replace(/\/+$/, '')
    this.logger = logger ?? getDefaultLogger()
    this.slug = `${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}`
  }

  capabilities(): ProviderCapabilities {
    return {
      pinIssues: false,
      // Bitbucket has commit statuses ("build statuses"), which is what
      // `createCheckRun` maps onto.
      checkRuns: true,
      inlineReviewComments: true,
      // Bitbucket renders no suggestion blocks a reviewer can apply.
      reviewSuggestions: false,
      nativeAutoMerge: false,
      commentReactions: false,
      ciLogs: false,
      teamReviewers: false,
      // Bitbucket has no draft state at all.
      draftPullRequests: false,
      permissionLookup: true,
      branchHousekeeping: true,
      reopenPullRequests: false,
      labels: false,
    }
  }

  // -- Transport -----------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { raw?: boolean, form?: Record<string, string> } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: options.raw ? 'text/plain' : 'application/json',
      'User-Agent': 'buddy-bot',
    }

    let payload: string | undefined

    if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      payload = new URLSearchParams(options.form).toString()
    }
    else if (body) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    const response = await fetchWithTimeout(`${this.apiUrl}${path}`, {
      method,
      headers,
      ...(payload ? { body: payload } : {}),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Bitbucket ${method} ${path} failed: ${response.status} ${detail.slice(0, 200)}`)
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

  /** Walk every page of a paginated collection. */
  private async collect<T>(path: string, maxPages = 10): Promise<T[]> {
    const values: T[] = []
    let next: string | undefined = `${this.apiUrl}${path}`

    for (let page = 0; page < maxPages && next; page++) {
      const url: string = next
      const response: Paged<T> | null = await this.optional<Paged<T>>(
        'GET',
        url.startsWith(this.apiUrl) ? url.slice(this.apiUrl.length) : url,
      )

      if (!response)
        break

      values.push(...(response.values ?? []))
      next = response.next
    }

    return values
  }

  // -- Branches ------------------------------------------------------------

  async branchExists(branchName: string): Promise<boolean> {
    const branch = await this.optional<unknown>(
      'GET',
      `/repositories/${this.slug}/refs/branches/${encodeURIComponent(branchName)}`,
    )

    return branch !== null
  }

  async createBranch(branchName: string, baseBranch: string): Promise<void> {
    await this.request('POST', `/repositories/${this.slug}/refs/branches`, {
      name: branchName,
      target: { hash: baseBranch },
    })
  }

  async deleteBranch(branchName: string): Promise<void> {
    await this.request(
      'DELETE',
      `/repositories/${this.slug}/refs/branches/${encodeURIComponent(branchName)}`,
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

    // Bitbucket's `/src` endpoint creates the branch implicitly when `parents`
    // names a commit on the base, so there is no separate branch call — and no
    // window in which a branch exists with nothing on it.
    const form: Record<string, string> = {
      message,
      branch: branchName,
    }

    for (const file of files) {
      if (file.type === 'delete')
        form.files = form.files ? `${form.files},${file.path}` : file.path
      else
        form[file.path] = file.content
    }

    // Bitbucket spells a deletion as a repeated `files` parameter rather than
    // a per-file action, so it is built separately from the content fields.
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(form)) {
      if (key === 'files')
        continue
      params.append(key, value)
    }
    for (const file of files) {
      if (file.type === 'delete')
        params.append('files', file.path)
    }

    const head = await this.headOf(baseBranch)
    if (head)
      params.append('parents', head)

    await this.request('POST', `/repositories/${this.slug}/src`, undefined, {
      form: Object.fromEntries(params.entries()),
    })
  }

  /** Head commit hash of a branch. */
  private async headOf(branch: string): Promise<string | null> {
    const ref = await this.optional<{ target?: { hash?: string } }>(
      'GET',
      `/repositories/${this.slug}/refs/branches/${encodeURIComponent(branch)}`,
    )

    return ref?.target?.hash ?? null
  }

  async getFileContent(path: string, ref: string): Promise<string | null> {
    // File content comes back as the file, not as JSON wrapping it — reading
    // it through the ordinary JSON path turns every text file into a parse
    // error and every parse error into a missing file.
    try {
      return await this.request<string>(
        'GET',
        `/repositories/${this.slug}/src/${encodeURIComponent(ref)}/${path}`,
        undefined,
        { raw: true },
      )
    }
    catch (error) {
      if (String(error).includes('404'))
        return null
      throw error
    }
  }

  // -- Pull requests -------------------------------------------------------

  async createPullRequest(options: PullRequestOptions): Promise<PullRequest> {
    // Bitbucket has no draft state and no labels. Both are dropped rather
    // than approximated — a "[Draft]" title prefix nothing understands is
    // worse than an honest absence.
    if (options.draft)
      this.logger.debug('Bitbucket has no draft pull requests; opening as ready')

    const created = await this.request<BitbucketPullRequest>(
      'POST',
      `/repositories/${this.slug}/pullrequests`,
      {
        title: options.title,
        description: options.body,
        source: { branch: { name: options.head } },
        destination: { branch: { name: options.base } },
        close_source_branch: true,
        ...(options.reviewers?.length
          ? { reviewers: options.reviewers.map(nickname => ({ nickname })) }
          : {}),
      },
    )

    return this.toPullRequest(created)
  }

  async getPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
    const states = state === 'open'
      ? ['OPEN']
      : state === 'closed'
        ? ['MERGED', 'DECLINED', 'SUPERSEDED']
        : ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']

    const query = states.map(value => `state=${value}`).join('&')
    const all = await this.collect<BitbucketPullRequest>(
      `/repositories/${this.slug}/pullrequests?${query}&pagelen=50`,
    )

    return all.map(pr => this.toPullRequest(pr))
  }

  async updatePullRequest(prNumber: number, options: Partial<PullRequestOptions>): Promise<PullRequest> {
    const updated = await this.request<BitbucketPullRequest>(
      'PUT',
      `/repositories/${this.slug}/pullrequests/${prNumber}`,
      {
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.body !== undefined ? { description: options.body } : {}),
        ...(options.base !== undefined ? { destination: { branch: { name: options.base } } } : {}),
      },
    )

    return this.toPullRequest(updated)
  }

  async closePullRequest(prNumber: number): Promise<void> {
    await this.request('POST', `/repositories/${this.slug}/pullrequests/${prNumber}/decline`)
  }

  async reopenPullRequest(prNumber: number): Promise<void> {
    // Bitbucket cannot reopen a declined pull request through the API. Failing
    // loudly beats a silent no-op that leaves a caller believing the pull
    // request is open again.
    throw new Error(
      `Bitbucket cannot reopen declined pull request #${prNumber}; open a new one from the same branch.`,
    )
  }

  async mergePullRequest(
    prNumber: number,
    strategy: 'merge' | 'squash' | 'rebase' = 'squash',
  ): Promise<void> {
    const strategies: Record<string, string> = {
      merge: 'merge_commit',
      squash: 'squash',
      rebase: 'fast_forward',
    }

    await this.request('POST', `/repositories/${this.slug}/pullrequests/${prNumber}/merge`, {
      merge_strategy: strategies[strategy] ?? 'squash',
      close_source_branch: true,
    })
  }

  async getPullRequestDiff(prNumber: number): Promise<string> {
    return await this.request<string>(
      'GET',
      `/repositories/${this.slug}/pullrequests/${prNumber}/diff`,
      undefined,
      { raw: true },
    )
  }

  async getPullRequestHeadSha(prNumber: number): Promise<string> {
    const pr = await this.request<BitbucketPullRequest>(
      'GET',
      `/repositories/${this.slug}/pullrequests/${prNumber}`,
    )

    return pr.source?.commit?.hash ?? ''
  }

  async createComment(prNumber: number, comment: string): Promise<void> {
    await this.request('POST', `/repositories/${this.slug}/pullrequests/${prNumber}/comments`, {
      content: { raw: comment },
    })
  }

  // -- Issues --------------------------------------------------------------

  async createIssue(options: IssueOptions): Promise<Issue> {
    const created = await this.request<BitbucketIssue>('POST', `/repositories/${this.slug}/issues`, {
      title: options.title,
      content: { raw: options.body },
      kind: 'task',
    })

    return this.toIssue(created)
  }

  async getIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
    // Bitbucket's issue tracker is optional per repository. A repository with
    // it disabled answers 404, which is not an error — there are simply no
    // issues.
    const issues = await this.collect<BitbucketIssue>(
      `/repositories/${this.slug}/issues?pagelen=50`,
    )

    const mapped = issues.map(issue => this.toIssue(issue))

    return state === 'all' ? mapped : mapped.filter(issue => issue.state === state)
  }

  async updateIssue(issueNumber: number, options: Partial<IssueOptions>): Promise<Issue> {
    const updated = await this.request<BitbucketIssue>(
      'PUT',
      `/repositories/${this.slug}/issues/${issueNumber}`,
      {
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.body !== undefined ? { content: { raw: options.body } } : {}),
      },
    )

    return this.toIssue(updated)
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.request('PUT', `/repositories/${this.slug}/issues/${issueNumber}`, {
      state: 'closed',
    })
  }

  async unpinIssue(_issueNumber: number): Promise<boolean> {
    return false
  }

  // -- Capability-gated ----------------------------------------------------

  async getPullRequestChecksState(prNumber: number): Promise<'success' | 'failure' | 'pending' | 'none'> {
    const sha = await this.getPullRequestHeadSha(prNumber)
    if (!sha)
      return 'none'

    const statuses = await this.collect<{ state?: string }>(
      `/repositories/${this.slug}/commit/${sha}/statuses?pagelen=50`,
    )

    if (statuses.length === 0)
      return 'none'

    if (statuses.some(status => status.state === 'FAILED' || status.state === 'STOPPED'))
      return 'failure'
    if (statuses.some(status => status.state === 'INPROGRESS'))
      return 'pending'
    if (statuses.every(status => status.state === 'SUCCESSFUL'))
      return 'success'

    return 'pending'
  }

  async createReview(prNumber: number, review: ReviewSubmission): Promise<ReviewSubmissionResult> {
    // Bitbucket has no review object: the summary is a comment, and inline
    // comments are comments with an `inline` anchor.
    await this.createComment(prNumber, review.body)

    if (!review.comments?.length)
      return { posted: true, inlineComments: 0 }

    let placed = 0

    for (const comment of review.comments) {
      try {
        await this.request('POST', `/repositories/${this.slug}/pullrequests/${prNumber}/comments`, {
          content: { raw: comment.body },
          inline: {
            path: comment.path,
            // `to` anchors on the new file, `from` on the old one.
            ...(comment.side === 'RIGHT' ? { to: comment.line } : { from: comment.line }),
          },
        })
        placed++
      }
      catch (error) {
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
      await this.request('POST', `/repositories/${this.slug}/commit/${headSha}/statuses/build`, {
        key: name.replace(/[^\w-]/g, '-').slice(0, 40),
        state: result.conclusion === 'failure' ? 'FAILED' : 'SUCCESSFUL',
        name: result.title.slice(0, 100),
        description: result.summary.slice(0, 300),
        url: 'https://buddy-bot.sh',
      })
    }
    catch (error) {
      this.logger.warn(`⚠️ Could not report build status ${name}: ${formatError(error)}`)
    }
  }

  async hasWriteAccess(username: string): Promise<boolean> {
    const permissions = await this.optional<Paged<{ permission?: string, user?: { nickname?: string } }>>(
      'GET',
      `/repositories/${this.slug}/permissions-config/users`,
    )

    const entry = permissions?.values?.find(value => value.user?.nickname === username)

    return entry?.permission === 'write' || entry?.permission === 'admin'
  }

  // -- Housekeeping --------------------------------------------------------

  async getBuddyBotBranches(): Promise<ProviderBranch[]> {
    const branches = await this.collect<{
      name?: string
      target?: { hash?: string, date?: string }
    }>(`/repositories/${this.slug}/refs/branches?q=${encodeURIComponent('name ~ "buddy-bot/"')}&pagelen=50`)

    return branches
      .filter(branch => branch.name?.startsWith('buddy-bot/'))
      .map(branch => ({
        name: branch.name!,
        sha: branch.target?.hash ?? '',
        lastCommitDate: branch.target?.date ? new Date(branch.target.date) : new Date(0),
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

  private toPullRequest(pr: BitbucketPullRequest): PullRequest {
    const state = pr.state === 'MERGED'
      ? 'merged'
      : pr.state === 'OPEN' ? 'open' : 'closed'

    return {
      number: pr.id,
      title: pr.title,
      body: pr.description ?? '',
      head: pr.source?.branch?.name ?? '',
      base: pr.destination?.branch?.name ?? '',
      state,
      url: pr.links?.html?.href ?? '',
      createdAt: new Date(pr.created_on),
      updatedAt: new Date(pr.updated_on),
      // Bitbucket records no merge timestamp separate from the last update, so
      // the update time is the closest true statement available.
      ...(state === 'merged' ? { mergedAt: new Date(pr.updated_on) } : {}),
      author: pr.author?.nickname ?? pr.author?.display_name ?? '',
      reviewers: (pr.reviewers ?? [])
        .map(user => user.nickname ?? user.display_name ?? '')
        .filter(Boolean),
      assignees: [],
      // Bitbucket pull requests have no labels.
      labels: [],
      draft: false,
    }
  }

  private toIssue(issue: BitbucketIssue): Issue {
    // Bitbucket has several closed-ish states; anything not actively open is
    // closed for buddy-bot's purposes.
    const isOpen = ['new', 'open', 'on hold'].includes(issue.state)

    return {
      number: issue.id,
      title: issue.title,
      body: issue.content?.raw ?? '',
      state: isOpen ? 'open' : 'closed',
      url: issue.links?.html?.href ?? '',
      createdAt: new Date(issue.created_on),
      updatedAt: new Date(issue.updated_on),
      ...(isOpen ? {} : { closedAt: new Date(issue.updated_on) }),
      author: issue.reporter?.nickname ?? issue.reporter?.display_name ?? '',
      assignees: [],
      labels: [],
    }
  }
}
