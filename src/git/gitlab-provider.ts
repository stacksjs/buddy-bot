import type { FileChange, GitProvider, Issue, IssueOptions, PullRequest, PullRequestOptions } from '../types'

/**
 * Placeholder GitLab provider. Not implemented — every method throws so callers
 * fail loudly instead of silently no-op'ing on a real GitLab repo. Prior revisions
 * returned fake data / empty arrays, which masked configuration bugs (PR creation
 * "succeeded" but nothing happened upstream).
 *
 * To implement, map each method to the GitLab REST API:
 *   https://docs.gitlab.com/ee/api/merge_requests.html
 *   https://docs.gitlab.com/ee/api/branches.html
 *   https://docs.gitlab.com/ee/api/issues.html
 */
export class GitLabProvider implements GitProvider {
  constructor(
    _token: string,
    _projectId: string,
  ) {
    throw new Error(
      'GitLabProvider is not implemented. buddy-bot currently supports GitHub only. '
      + 'See https://github.com/stacksjs/buddy-bot to track GitLab support.',
    )
  }

  private unsupported(): never {
    throw new Error('GitLabProvider is not implemented')
  }

  async branchExists(_branchName: string): Promise<boolean> { return this.unsupported() }
  async createBranch(_branchName: string, _baseBranch: string): Promise<void> { return this.unsupported() }
  async commitChanges(_branchName: string, _message: string, _files: FileChange[], _baseBranch?: string): Promise<void> { return this.unsupported() }
  async createPullRequest(_options: PullRequestOptions): Promise<PullRequest> { return this.unsupported() }
  async getPullRequests(_state?: 'open' | 'closed' | 'all'): Promise<PullRequest[]> { return this.unsupported() }
  async updatePullRequest(_prNumber: number, _options: Partial<PullRequestOptions>): Promise<PullRequest> { return this.unsupported() }
  async closePullRequest(_prNumber: number): Promise<void> { return this.unsupported() }
  async reopenPullRequest(_prNumber: number): Promise<void> { return this.unsupported() }
  async createComment(_prNumber: number, _comment: string): Promise<void> { return this.unsupported() }
  async mergePullRequest(_prNumber: number, _strategy?: 'merge' | 'squash' | 'rebase'): Promise<void> { return this.unsupported() }
  async deleteBranch(_branchName: string): Promise<void> { return this.unsupported() }
  async createIssue(_options: IssueOptions): Promise<Issue> { return this.unsupported() }
  async getIssues(_state?: 'open' | 'closed' | 'all'): Promise<Issue[]> { return this.unsupported() }
  async updateIssue(_issueNumber: number, _options: Partial<IssueOptions>): Promise<Issue> { return this.unsupported() }
  async closeIssue(_issueNumber: number): Promise<void> { return this.unsupported() }
  async unpinIssue(_issueNumber: number): Promise<void> { return this.unsupported() }
}
