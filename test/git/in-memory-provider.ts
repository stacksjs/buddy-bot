import type {
  CheckRunResult,
  GitProvider,
  ProviderCapabilities,
  ReviewSubmission,
  ReviewSubmissionResult,
} from '../../src/git/provider'
import type { FileChange, Issue, IssueOptions, PullRequest, PullRequestOptions } from '../../src/types'
import { NO_CAPABILITIES } from '../../src/git/provider'

/**
 * A complete {@link GitProvider} backed by maps.
 *
 * Two jobs: prove the interface is implementable by something that is not
 * GitHub, and give end-to-end tests a provider that needs no network. Its
 * capability set is deliberately partial — pinning and check runs are off — so
 * the conformance suite's degradation paths are actually exercised rather than
 * assumed.
 */
export class InMemoryProvider implements GitProvider {
  private branches = new Map<string, Map<string, string>>([['main', new Map()]])
  private pullRequests = new Map<number, PullRequest>()
  private issues = new Map<number, Issue>()
  private pinned = new Set<number>()
  private nextNumber = 1

  /** Everything posted, so tests can assert on side effects. */
  readonly comments: Array<{ number: number, body: string }> = []
  readonly reviews: Array<{ number: number, review: ReviewSubmission }> = []

  constructor(private readonly overrides: Partial<ProviderCapabilities> = {}) {}

  capabilities(): ProviderCapabilities {
    return {
      ...NO_CAPABILITIES,
      inlineReviewComments: true,
      draftPullRequests: true,
      teamReviewers: true,
      ...this.overrides,
    }
  }

  // -- Branches ------------------------------------------------------------

  async branchExists(branchName: string): Promise<boolean> {
    return this.branches.has(branchName)
  }

  async createBranch(branchName: string, baseBranch: string): Promise<void> {
    const base = this.branches.get(baseBranch)
    if (!base)
      throw new Error(`Base branch ${baseBranch} does not exist`)
    this.branches.set(branchName, new Map(base))
  }

  async deleteBranch(branchName: string): Promise<void> {
    this.branches.delete(branchName)
  }

  async commitChanges(branchName: string, _message: string, files: FileChange[], baseBranch = 'main'): Promise<void> {
    // Reset-then-apply, matching the real providers: a re-run produces the
    // same tree rather than stacking fixups on top of the previous attempt.
    const base = this.branches.get(baseBranch) ?? new Map<string, string>()
    const tree = new Map(base)

    for (const file of files) {
      if (file.type === 'delete')
        tree.delete(file.path)
      else
        tree.set(file.path, file.content)
    }

    this.branches.set(branchName, tree)
  }

  async getFileContent(path: string, ref: string): Promise<string | null> {
    return this.branches.get(ref)?.get(path) ?? null
  }

  // -- Pull requests -------------------------------------------------------

  async createPullRequest(options: PullRequestOptions): Promise<PullRequest> {
    const number = this.nextNumber++
    const now = new Date()

    const pr: PullRequest = {
      number,
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
      state: 'open',
      url: `https://git.test/o/r/pull/${number}`,
      createdAt: now,
      updatedAt: now,
      author: 'buddy-bot',
      reviewers: options.reviewers ?? [],
      assignees: options.assignees ?? [],
      labels: options.labels ?? [],
      draft: options.draft ?? false,
    }

    this.pullRequests.set(number, pr)
    return pr
  }

  async getPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
    const all = [...this.pullRequests.values()]
    if (state === 'all')
      return all
    // A merged pull request is closed for filtering purposes but keeps its
    // distinct state, which is what auto-close logic branches on.
    if (state === 'closed')
      return all.filter(pr => pr.state !== 'open')
    return all.filter(pr => pr.state === 'open')
  }

  async updatePullRequest(prNumber: number, options: Partial<PullRequestOptions>): Promise<PullRequest> {
    const pr = this.requirePullRequest(prNumber)
    const updated: PullRequest = {
      ...pr,
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.base !== undefined ? { base: options.base } : {}),
      ...(options.draft !== undefined ? { draft: options.draft } : {}),
      ...(options.labels !== undefined ? { labels: options.labels } : {}),
      updatedAt: new Date(),
    }

    this.pullRequests.set(prNumber, updated)
    return updated
  }

  async closePullRequest(prNumber: number): Promise<void> {
    this.pullRequests.set(prNumber, { ...this.requirePullRequest(prNumber), state: 'closed' })
  }

  async reopenPullRequest(prNumber: number): Promise<void> {
    this.pullRequests.set(prNumber, { ...this.requirePullRequest(prNumber), state: 'open' })
  }

  async mergePullRequest(prNumber: number, _strategy: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<void> {
    this.pullRequests.set(prNumber, {
      ...this.requirePullRequest(prNumber),
      state: 'merged',
      mergedAt: new Date(),
    })
  }

  async getPullRequestDiff(prNumber: number): Promise<string> {
    this.requirePullRequest(prNumber)
    return ''
  }

  async getPullRequestHeadSha(prNumber: number): Promise<string> {
    return `sha-${this.requirePullRequest(prNumber).head}`
  }

  async createComment(prNumber: number, comment: string): Promise<void> {
    this.requirePullRequest(prNumber)
    this.comments.push({ number: prNumber, body: comment })
  }

  // -- Issues --------------------------------------------------------------

  async createIssue(options: IssueOptions): Promise<Issue> {
    const number = this.nextNumber++
    const now = new Date()

    const issue: Issue = {
      number,
      title: options.title,
      body: options.body,
      state: 'open',
      url: `https://git.test/o/r/issues/${number}`,
      createdAt: now,
      updatedAt: now,
      author: 'buddy-bot',
      assignees: options.assignees ?? [],
      labels: options.labels ?? [],
    }

    this.issues.set(number, issue)
    return issue
  }

  async getIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
    const all = [...this.issues.values()]
    return state === 'all' ? all : all.filter(issue => issue.state === state)
  }

  async updateIssue(issueNumber: number, options: Partial<IssueOptions>): Promise<Issue> {
    const issue = this.requireIssue(issueNumber)
    const updated: Issue = {
      ...issue,
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.labels !== undefined ? { labels: options.labels } : {}),
      updatedAt: new Date(),
    }

    this.issues.set(issueNumber, updated)
    return updated
  }

  async closeIssue(issueNumber: number): Promise<void> {
    this.issues.set(issueNumber, {
      ...this.requireIssue(issueNumber),
      state: 'closed',
      closedAt: new Date(),
    })
  }

  async unpinIssue(issueNumber: number): Promise<boolean> {
    // Safe to call unconditionally: reports what happened rather than throwing
    // on a platform that cannot pin.
    if (!this.capabilities().pinIssues)
      return false
    return this.pinned.delete(issueNumber)
  }

  async pinIssue(issueNumber: number): Promise<boolean> {
    if (!this.capabilities().pinIssues)
      return false
    this.pinned.add(issueNumber)
    return true
  }

  async createReview(prNumber: number, review: ReviewSubmission): Promise<ReviewSubmissionResult> {
    this.requirePullRequest(prNumber)
    this.reviews.push({ number: prNumber, review })
    return { posted: true, inlineComments: review.comments?.length ?? 0 }
  }

  async createCheckRun(_name: string, _headSha: string, _result: CheckRunResult): Promise<void> {
    if (!this.capabilities().checkRuns)
      throw new Error('check runs are not supported by this provider')
  }

  private requirePullRequest(prNumber: number): PullRequest {
    const pr = this.pullRequests.get(prNumber)
    if (!pr)
      throw new Error(`Pull request #${prNumber} not found`)
    return pr
  }

  private requireIssue(issueNumber: number): Issue {
    const issue = this.issues.get(issueNumber)
    if (!issue)
      throw new Error(`Issue #${issueNumber} not found`)
    return issue
  }
}
