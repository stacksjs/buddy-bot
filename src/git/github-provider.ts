/* eslint-disable no-console */
import type { FileChange, GitProvider, Issue, IssueOptions, PullRequest, PullRequestOptions } from '../types'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'

export class GitHubProvider implements GitProvider {
  private readonly apiUrl = 'https://api.github.com'

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
    private readonly hasWorkflowPermissions: boolean = false,
  ) {}

  async createBranch(branchName: string, baseBranch: string): Promise<void> {
    try {
      // Get the base branch SHA
      const baseRef = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/git/ref/heads/${baseBranch}`)
      const baseSha = baseRef.object.sha

      // Create new branch
      await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/git/refs`, {
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      })

      console.log(`✅ Created branch ${branchName} from ${baseBranch}`)
    }
    catch (error) {
      console.error(`❌ Failed to create branch ${branchName}:`, error)
      throw error
    }
  }

  async commitChanges(branchName: string, message: string, files: FileChange[]): Promise<void> {
    // Try Git CLI first for better compatibility with GitHub Actions permissions
    try {
      await this.commitChangesWithGit(branchName, message, files)
    }
    catch (gitError) {
      console.warn(`⚠️ Git CLI commit failed, falling back to GitHub API: ${gitError}`)
      await this.commitChangesWithAPI(branchName, message, files)
    }
  }

  private async commitChangesWithGit(branchName: string, message: string, files: FileChange[]): Promise<void> {
    try {
      // Handle workflow files based on token permissions
      const workflowFiles = files.filter(f => f.path.includes('.github/workflows/'))
      const nonWorkflowFiles = files.filter(f => !f.path.includes('.github/workflows/'))

      if (workflowFiles.length > 0 && !this.hasWorkflowPermissions) {
        console.warn(`⚠️ Detected ${workflowFiles.length} workflow file(s). These require elevated permissions.`)
        console.warn(`⚠️ Workflow files: ${workflowFiles.map(f => f.path).join(', ')}`)
        console.warn(`ℹ️ Workflow files will be skipped in this commit. BUDDY_BOT_TOKEN not detected or lacks workflow permissions.`)

        // If we have non-workflow files, commit just those
        if (nonWorkflowFiles.length > 0) {
          console.log(`📝 Committing ${nonWorkflowFiles.length} non-workflow files...`)
          files = nonWorkflowFiles
        }
        else {
          console.warn(`⚠️ All files are workflow files. No files will be committed in this PR.`)
          console.warn(`💡 To update workflow files, ensure BUDDY_BOT_TOKEN is set with workflow:write permissions.`)
          return // Exit early if no non-workflow files to commit
        }
      }
      else if (workflowFiles.length > 0) {
        console.log(`✅ Including ${workflowFiles.length} workflow file(s) with elevated permissions`)
      }

      // Configure Git identity if not already set
      // try {
      //   await this.runCommand('git', ['config', 'user.name', 'buddy-bot[bot]'])
      //   await this.runCommand('git', ['config', 'user.email', 'buddy-bot[bot]@users.noreply.github.com'])
      // }
      // catch {
      //   // Ignore config errors if already set
      // }

      // Fetch latest changes
      await this.runCommand('git', ['fetch', 'origin'])

      // For rebase operations, reset the branch to main and apply changes fresh
      // This prevents merge conflicts by starting with a clean slate
      console.log(`🔄 Resetting ${branchName} to main for clean rebase...`)

      // Checkout main first and reset working directory to clean state
      await this.runCommand('git', ['checkout', 'main'])
      await this.runCommand('git', ['reset', '--hard', 'HEAD'])
      await this.runCommand('git', ['clean', '-fd'])

      // Reset the branch to main (delete and recreate)
      try {
        await this.runCommand('git', ['branch', '-D', branchName])
      }
      catch {
        // Branch might not exist locally, that's ok
      }

      // Create fresh branch from main
      await this.runCommand('git', ['checkout', '-b', branchName])

      // Apply file changes
      for (const file of files) {
        const cleanPath = file.path.replace(/^\.\//, '').replace(/^\/+/, '')

        if (file.type === 'delete') {
          try {
            await this.runCommand('git', ['rm', cleanPath])
          }
          catch {
            // File might not exist, that's ok for delete operations
          }
        }
        else {
          // Write file content
          const fs = await import('node:fs')
          const path = await import('node:path')

          // Ensure directory exists
          const dir = path.dirname(cleanPath)
          if (dir !== '.') {
            fs.mkdirSync(dir, { recursive: true })
          }

          fs.writeFileSync(cleanPath, file.content, 'utf8')
          await this.runCommand('git', ['add', cleanPath])
        }
      }

      // Check if there are changes to commit
      const status = await this.runCommand('git', ['status', '--porcelain'])
      if (status.trim()) {
        // Commit changes
        await this.runCommand('git', ['commit', '-m', message])

        // Force push changes to overwrite the existing branch
        await this.runCommand('git', ['push', 'origin', branchName, '--force'])

        console.log(`✅ Successfully rebased ${branchName} with fresh changes: ${message}`)
      }
      else {
        console.log(`ℹ️ No changes to commit for ${branchName}`)
      }
    }
    catch (error) {
      console.error(`❌ Failed to commit changes to ${branchName} with Git CLI:`, error)
      throw error
    }
  }

  private async commitChangesWithAPI(branchName: string, message: string, files: FileChange[]): Promise<void> {
    try {
      // Handle workflow files based on token permissions
      const workflowFiles = files.filter(f => f.path.includes('.github/workflows/'))
      const nonWorkflowFiles = files.filter(f => !f.path.includes('.github/workflows/'))

      if (workflowFiles.length > 0 && !this.hasWorkflowPermissions) {
        console.warn(`⚠️ Detected ${workflowFiles.length} workflow file(s). These require elevated permissions.`)
        console.warn(`⚠️ Workflow files: ${workflowFiles.map(f => f.path).join(', ')}`)
        console.warn(`ℹ️ Workflow files will be skipped in this commit. Consider using a GitHub App with workflow permissions for workflow updates.`)

        // If we have non-workflow files, commit just those
        if (nonWorkflowFiles.length > 0) {
          console.log(`📝 Committing ${nonWorkflowFiles.length} non-workflow files...`)
          files = nonWorkflowFiles
        }
        else {
          console.warn(`⚠️ All files are workflow files. No files will be committed in this PR.`)
          console.warn(`💡 To update workflow files, consider using a GitHub App with appropriate permissions.`)
          return // Exit early if no non-workflow files to commit
        }
      }
      else if (workflowFiles.length > 0) {
        console.log(`✅ Including ${workflowFiles.length} workflow file(s) with elevated permissions`)
      }

      // Get current branch SHA
      const branchRef = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/git/ref/heads/${branchName}`)
      const currentSha = branchRef.object.sha

      // Get current tree
      const currentCommit = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/git/commits/${currentSha}`)
      const currentTreeSha = currentCommit.tree.sha

      // Create new tree with file changes
      const tree = []
      for (const file of files) {
        // Ensure path doesn't start with ./ or have leading slashes (GitHub API requires clean relative paths)
        const cleanPath = file.path.replace(/^\.\//, '').replace(/^\/+/, '')

        if (file.type === 'delete') {
          tree.push({
            path: cleanPath,
            mode: '100644',
            type: 'blob',
            sha: null,
          })
        }
        else {
          // Create blob for file content
          const blob = await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/git/blobs`, {
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64',
          })

          tree.push({
            path: cleanPath,
            mode: '100644',
            type: 'blob',
            sha: blob.sha,
          })
        }
      }

      const newTree = await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/git/trees`, {
        base_tree: currentTreeSha,
        tree,
      })

      // Create new commit
      const newCommit = await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/git/commits`, {
        message,
        tree: newTree.sha,
        parents: [currentSha],
      })

      // Update branch reference
      await this.apiRequest(`PATCH /repos/${this.owner}/${this.repo}/git/refs/heads/${branchName}`, {
        sha: newCommit.sha,
      })

      console.log(`✅ Committed changes to ${branchName}: ${message}`)
    }
    catch (error) {
      console.error(`❌ Failed to commit changes to ${branchName}:`, error)
      throw error
    }
  }

  async createPullRequest(options: PullRequestOptions): Promise<PullRequest> {
    // Try GitHub CLI first as it might have better permission handling
    try {
      return await this.createPullRequestWithCLI(options)
    }
    catch (cliError) {
      console.warn(`⚠️ GitHub CLI failed, falling back to API: ${cliError}`)
      return await this.createPullRequestWithAPI(options)
    }
  }

  /**
   * Create pull request using GitHub CLI
   */
  private async createPullRequestWithCLI(options: PullRequestOptions): Promise<PullRequest> {
    try {
      // Prepare the command
      const args = [
        'pr',
        'create',
        '--title',
        options.title,
        '--body',
        options.body,
        '--head',
        options.head,
        '--base',
        options.base,
      ]

      if (options.draft) {
        args.push('--draft')
      }

      if (options.reviewers && options.reviewers.length > 0) {
        console.log(`🔍 Adding reviewers via CLI: ${options.reviewers.join(', ')}`)
        args.push('--reviewer', options.reviewers.join(','))
      }

      if (options.assignees && options.assignees.length > 0) {
        args.push('--assignee', options.assignees.join(','))
      }

      if (options.labels && options.labels.length > 0) {
        args.push('--label', options.labels.join(','))
      }

      // Execute GitHub CLI command
      const result = await this.runCommand('gh', args)

      // Parse the PR URL from the output (GitHub CLI returns the PR URL)
      const prUrlMatch = result.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)
      if (!prUrlMatch) {
        throw new Error('Failed to parse PR number from GitHub CLI output')
      }

      const prNumber = Number.parseInt(prUrlMatch[1])
      const prUrl = prUrlMatch[0]

      console.log(`✅ Created PR #${prNumber}: ${options.title}`)

      return {
        number: prNumber,
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base,
        state: 'open',
        url: prUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
        author: 'github-actions[bot]',
        reviewers: options.reviewers || [],
        assignees: options.assignees || [],
        labels: options.labels || [],
        draft: options.draft || false,
      }
    }
    catch (error) {
      console.error(`❌ Failed to create PR with GitHub CLI: ${options.title}`, error)
      throw error
    }
  }

  /**
   * Create pull request using GitHub API (fallback)
   */
  private async createPullRequestWithAPI(options: PullRequestOptions): Promise<PullRequest> {
    try {
      const response = await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/pulls`, {
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base,
        draft: options.draft || false,
      })

      // Add reviewers if specified
      if (options.reviewers && options.reviewers.length > 0) {
        try {
          console.log(`🔍 Adding reviewers to PR #${response.number}: ${options.reviewers.join(', ')}`)
          await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/pulls/${response.number}/requested_reviewers`, {
            reviewers: options.reviewers,
            team_reviewers: options.teamReviewers || [],
          })
          console.log(`✅ Successfully added reviewers: ${options.reviewers.join(', ')}`)
        }
        catch (reviewerError) {
          console.error(`❌ Failed to add reviewers: ${reviewerError}`)
          console.error(`   Reviewers: ${options.reviewers.join(', ')}`)
          console.error(`   Repository: ${this.owner}/${this.repo}`)
          console.error(`   PR: #${response.number}`)
        }
      }

      // Add assignees if specified
      if (options.assignees && options.assignees.length > 0) {
        try {
          await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/issues/${response.number}/assignees`, {
            assignees: options.assignees,
          })
        }
        catch (assigneeError) {
          console.warn(`⚠️ Failed to add assignees: ${assigneeError}`)
        }
      }

      // Add labels if specified
      if (options.labels && options.labels.length > 0) {
        try {
          await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/issues/${response.number}/labels`, {
            labels: options.labels,
          })
        }
        catch (labelError) {
          console.warn(`⚠️ Failed to add labels: ${labelError}`)
        }
      }

      console.log(`✅ Created PR #${response.number}: ${options.title}`)

      return {
        number: response.number,
        title: response.title,
        body: response.body || '',
        head: response.head.ref,
        base: response.base.ref,
        state: response.state as 'open' | 'closed' | 'merged',
        url: response.html_url,
        createdAt: new Date(response.created_at),
        updatedAt: new Date(response.updated_at),
        author: response.user.login,
        reviewers: options.reviewers || [],
        assignees: options.assignees || [],
        labels: options.labels || [],
        draft: response.draft,
      }
    }
    catch (error) {
      console.error(`❌ Failed to create PR with API: ${options.title}`, error)
      throw error
    }
  }

  /**
   * Run a command and return its output
   */
  private async runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'pipe',
        env: {
          ...process.env,
          GITHUB_TOKEN: this.token,
          GH_TOKEN: this.token,
        },
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        }
        else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`))
        }
      })

      child.on('error', (error) => {
        reject(error)
      })
    })
  }

  async getPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
    try {
      const response = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/pulls?state=${state}`)

      return response.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        head: pr.head.ref,
        base: pr.base.ref,
        state: pr.state,
        url: pr.html_url,
        createdAt: new Date(pr.created_at),
        updatedAt: new Date(pr.updated_at),
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
        author: pr.user.login,
        reviewers: pr.requested_reviewers?.map((r: any) => r.login) || [],
        assignees: pr.assignees?.map((a: any) => a.login) || [],
        labels: pr.labels?.map((l: any) => l.name) || [],
        draft: pr.draft,
      }))
    }
    catch (error) {
      console.error(`❌ Failed to get PRs:`, error)
      throw error
    }
  }

  async updatePullRequest(prNumber: number, options: Partial<PullRequestOptions>): Promise<PullRequest> {
    try {
      const updateData: any = {}
      if (options.title)
        updateData.title = options.title
      if (options.body)
        updateData.body = options.body
      if (options.base)
        updateData.base = options.base
      if (options.draft !== undefined)
        updateData.draft = options.draft

      const response = await this.apiRequest(`PATCH /repos/${this.owner}/${this.repo}/pulls/${prNumber}`, updateData)

      // Update labels if specified
      if (options.labels && options.labels.length > 0) {
        try {
          await this.apiRequest(`PUT /repos/${this.owner}/${this.repo}/issues/${prNumber}/labels`, {
            labels: options.labels,
          })
          console.log(`✅ Updated labels for PR #${prNumber}: ${options.labels.join(', ')}`)
        }
        catch (labelError) {
          console.warn(`⚠️ Failed to update labels for PR #${prNumber}: ${labelError}`)
        }
      }

      // Update reviewers if specified
      if (options.reviewers && options.reviewers.length > 0) {
        try {
          console.log(`🔍 Adding reviewers to existing PR #${prNumber}: ${options.reviewers.join(', ')}`)
          await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/pulls/${prNumber}/requested_reviewers`, {
            reviewers: options.reviewers,
            team_reviewers: options.teamReviewers || [],
          })
          console.log(`✅ Updated reviewers for PR #${prNumber}: ${options.reviewers.join(', ')}`)
        }
        catch (reviewerError) {
          console.error(`❌ Failed to update reviewers for PR #${prNumber}: ${reviewerError}`)
          console.error(`   Reviewers: ${options.reviewers.join(', ')}`)
          console.error(`   Repository: ${this.owner}/${this.repo}`)
        }
      }

      // Update assignees if specified
      if (options.assignees && options.assignees.length > 0) {
        try {
          // Use GitHub CLI for assignees (more reliable with permissions)
          await this.runCommand('gh', ['issue', 'edit', prNumber.toString(), '--add-assignee', options.assignees.join(',')])
          console.log(`✅ Updated assignees for PR #${prNumber}: ${options.assignees.join(', ')}`)
        }
        catch (assigneeError) {
          console.warn(`⚠️ Failed to update assignees for PR #${prNumber}: ${assigneeError}`)
        }
      }

      console.log(`✅ Updated PR #${prNumber}`)

      return {
        number: response.number,
        title: response.title,
        body: response.body || '',
        head: response.head.ref,
        base: response.base.ref,
        state: response.state,
        url: response.html_url,
        createdAt: new Date(response.created_at),
        updatedAt: new Date(response.updated_at),
        author: response.user.login,
        reviewers: [],
        assignees: [],
        labels: options.labels || [],
        draft: response.draft,
      }
    }
    catch (error) {
      console.error(`❌ Failed to update PR #${prNumber}:`, error)
      throw error
    }
  }

  async closePullRequest(prNumber: number): Promise<void> {
    try {
      await this.apiRequest(`PATCH /repos/${this.owner}/${this.repo}/pulls/${prNumber}`, {
        state: 'closed',
      })
      console.log(`✅ Closed PR #${prNumber}`)
    }
    catch (error) {
      console.error(`❌ Failed to close PR #${prNumber}:`, error)
      throw error
    }
  }

  async mergePullRequest(prNumber: number, strategy: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<void> {
    try {
      const mergeMethod = strategy === 'rebase' ? 'rebase' : strategy === 'squash' ? 'squash' : 'merge'

      await this.apiRequest(`PUT /repos/${this.owner}/${this.repo}/pulls/${prNumber}/merge`, {
        merge_method: mergeMethod,
      })

      console.log(`✅ Merged PR #${prNumber} using ${strategy}`)
    }
    catch (error) {
      console.error(`❌ Failed to merge PR #${prNumber}:`, error)
      throw error
    }
  }

  /**
   * Make authenticated API request to GitHub
   */
  private async apiRequest(endpoint: string, data?: any): Promise<any> {
    const [method, path] = endpoint.split(' ')
    const url = `${this.apiUrl}${path}`

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'buddy-bot',
      },
    }

    if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      options.body = JSON.stringify(data)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}\n${errorBody}`)
    }

    if (response.headers.get('content-type')?.includes('application/json')) {
      return response.json()
    }

    return response.text()
  }

  async createIssue(options: IssueOptions): Promise<Issue> {
    try {
      const response = await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/issues`, {
        title: options.title,
        body: options.body,
        assignees: options.assignees || [],
        labels: options.labels || [],
        milestone: options.milestone,
      })

      console.log(`✅ Created issue #${response.number}: ${options.title}`)

      return {
        number: response.number,
        title: response.title,
        body: response.body,
        state: response.state,
        url: response.html_url,
        createdAt: new Date(response.created_at),
        updatedAt: new Date(response.updated_at),
        closedAt: response.closed_at ? new Date(response.closed_at) : undefined,
        author: response.user.login,
        assignees: response.assignees?.map((a: any) => a.login) || [],
        labels: response.labels?.map((l: any) => typeof l === 'string' ? l : l.name) || [],
        pinned: false, // GitHub API doesn't return pinned status directly
      }
    }
    catch (error) {
      console.error(`❌ Failed to create issue: ${options.title}`, error)
      throw error
    }
  }

  async getIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
    try {
      const response = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/issues?state=${state}&sort=updated&direction=desc`)

      return response
        .filter((issue: any) => !issue.pull_request) // Filter out PRs (they're returned as issues by GitHub API)
        .map((issue: any) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body || '',
          state: issue.state,
          url: issue.html_url,
          createdAt: new Date(issue.created_at),
          updatedAt: new Date(issue.updated_at),
          closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
          author: issue.user.login,
          assignees: issue.assignees?.map((a: any) => a.login) || [],
          labels: issue.labels?.map((l: any) => typeof l === 'string' ? l : l.name) || [],
          pinned: false, // GitHub API doesn't return pinned status directly
        }))
    }
    catch (error) {
      console.error('❌ Failed to get issues:', error)
      throw error
    }
  }

  async updateIssue(issueNumber: number, options: Partial<IssueOptions>): Promise<Issue> {
    try {
      const updateData: any = {}

      if (options.title !== undefined)
        updateData.title = options.title
      if (options.body !== undefined)
        updateData.body = options.body
      if (options.assignees !== undefined)
        updateData.assignees = options.assignees
      if (options.labels !== undefined)
        updateData.labels = options.labels
      if (options.milestone !== undefined)
        updateData.milestone = options.milestone

      const response = await this.apiRequest(`PATCH /repos/${this.owner}/${this.repo}/issues/${issueNumber}`, updateData)

      console.log(`✅ Updated issue #${issueNumber}: ${response.title}`)

      return {
        number: response.number,
        title: response.title,
        body: response.body,
        state: response.state,
        url: response.html_url,
        createdAt: new Date(response.created_at),
        updatedAt: new Date(response.updated_at),
        closedAt: response.closed_at ? new Date(response.closed_at) : undefined,
        author: response.user.login,
        assignees: response.assignees?.map((a: any) => a.login) || [],
        labels: response.labels?.map((l: any) => typeof l === 'string' ? l : l.name) || [],
        pinned: false, // GitHub API doesn't return pinned status directly
      }
    }
    catch (error) {
      console.error(`❌ Failed to update issue #${issueNumber}:`, error)
      throw error
    }
  }

  async closeIssue(issueNumber: number): Promise<void> {
    try {
      await this.apiRequest(`PATCH /repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
        state: 'closed',
      })

      console.log(`✅ Closed issue #${issueNumber}`)
    }
    catch (error) {
      console.error(`❌ Failed to close issue #${issueNumber}:`, error)
      throw error
    }
  }

  async unpinIssue(issueNumber: number): Promise<void> {
    try {
      await this.apiRequest(`DELETE /repos/${this.owner}/${this.repo}/issues/${issueNumber}/pin`, undefined)
    }
    catch (error: any) {
      console.log(`⚠️ Failed to unpin issue #${issueNumber}:`, error)
      // Don't throw error for pinning failures as it's not critical
    }
  }

  // Note: GitHub REST API does not support pinning issues programmatically
  // Pinning can only be done manually through the GitHub web interface
  // See: https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/pinning-an-issue-to-your-repository
}
