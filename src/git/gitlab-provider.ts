/* eslint-disable no-console */
import type { FileChange, GitProvider, Issue, IssueOptions, PullRequest, PullRequestOptions } from '../types'

export class GitLabProvider implements GitProvider {
  constructor(
    private readonly token: string,
    private readonly projectId: string,
  ) {}

  async branchExists(branchName: string): Promise<boolean> {
    // TODO: Implement GitLab API call to check if branch exists
    console.log(`Would check if branch ${branchName} exists`)
    return false
  }

  async createBranch(branchName: string, baseBranch: string): Promise<void> {
    // TODO: Implement GitLab API call to create branch
    console.log(`Would create branch ${branchName} from ${baseBranch}`)
  }

  async commitChanges(branchName: string, message: string, files: FileChange[]): Promise<void> {
    // TODO: Implement GitLab API call to commit changes
    console.log(`Would commit ${files.length} files to ${branchName} with message: ${message}`)
  }

  async createPullRequest(options: PullRequestOptions): Promise<PullRequest> {
    // TODO: Implement GitLab API call to create merge request
    console.log(`Would create MR: ${options.title}`)

    return {
      number: 1,
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
      state: 'open',
      url: `https://gitlab.com/project/${this.projectId}/-/merge_requests/1`,
      createdAt: new Date(),
      updatedAt: new Date(),
      author: 'buddy',
      reviewers: options.reviewers || [],
      assignees: options.assignees || [],
      labels: options.labels || [],
      draft: options.draft || false,
    }
  }

  async getPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
    // TODO: Implement GitLab API call to get MRs
    console.log(`Would get ${state} MRs`)
    return []
  }

  async updatePullRequest(prNumber: number, _options: Partial<PullRequestOptions>): Promise<PullRequest> {
    // TODO: Implement GitLab API call to update MR
    console.log(`Would update MR #${prNumber}`)
    throw new Error('Not implemented')
  }

  async closePullRequest(prNumber: number): Promise<void> {
    // TODO: Implement GitLab API call to close MR
    console.log(`Would close MR #${prNumber}`)
  }

  async createComment(prNumber: number, comment: string): Promise<void> {
    // TODO: Implement GitLab API call to create comment
    console.log(`Would add comment to MR #${prNumber}: ${comment}`)
  }

  async mergePullRequest(prNumber: number, strategy: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<void> {
    // TODO: Implement GitLab API call to merge MR
    console.log(`Would merge MR #${prNumber} using ${strategy}`)
  }

  async deleteBranch(branchName: string): Promise<void> {
    // TODO: Implement GitLab API call to delete branch
    console.log(`Would delete branch ${branchName}`)
  }

  async createIssue(options: IssueOptions): Promise<Issue> {
    // TODO: Implement GitLab API call to create issue
    console.log(`Would create issue: ${options.title}`)

    return {
      number: 1,
      title: options.title,
      body: options.body,
      state: 'open',
      url: `https://gitlab.com/project/${this.projectId}/-/issues/1`,
      createdAt: new Date(),
      updatedAt: new Date(),
      author: 'buddy',
      assignees: options.assignees || [],
      labels: options.labels || [],
      pinned: false,
    }
  }

  async getIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
    // TODO: Implement GitLab API call to get issues
    console.log(`Would get ${state} issues`)
    return []
  }

  async updateIssue(issueNumber: number, _options: Partial<IssueOptions>): Promise<Issue> {
    // TODO: Implement GitLab API call to update issue
    console.log(`Would update issue #${issueNumber}`)
    throw new Error('Not implemented')
  }

  async closeIssue(issueNumber: number): Promise<void> {
    // TODO: Implement GitLab API call to close issue
    console.log(`Would close issue #${issueNumber}`)
  }

  async unpinIssue(_issueNumber: number): Promise<void> {
    // GitLab doesn't have issue pinning functionality
    console.log(`ℹ️ GitLab does not support issue pinning`)
  }
}
