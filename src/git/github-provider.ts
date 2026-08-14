import type { FileChange, GitProvider, Issue, IssueOptions, PullRequest, PullRequestOptions } from '../types'
import type { Logger } from '../utils/logger'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { getGitHubApiUrl } from '../utils/endpoints'
import { formatError, GitHubApiError } from '../utils/errors'
import { assertUpdateTargetsExist, FileChangeValidationError, normalizeRepositoryPath } from '../utils/file-changes'
import { fetchWithTimeout } from '../utils/http'
import { detectRequiredPackageManagers, getAllLockFilePaths, regenerateLockFile } from '../utils/lock-file'
import { getDefaultLogger } from '../utils/logger'

// Match GitHub token formats (ghp_*, gho_*, ghs_*, ghu_*, ghr_*, github_pat_*)
// plus any 40+ char alphanumeric blob that looks like a credential.
const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Z0-9_]{20,}|github_pat_[A-Z0-9_]{20,}|[A-Z0-9]{40,})\b/gi

function sanitizeStderr(stderr: string, token?: string): string {
  let out = stderr.replace(TOKEN_PATTERN, '[REDACTED]')
  if (token && token.length >= 8)
    out = out.split(token).join('[REDACTED]')
  return out
}

// Minimal shapes for the GitHub REST responses buddy-bot consumes. These exist
// to replace scattered `as any` casts with narrowed types at the API boundary.
interface GitHubUser { login: string }
interface GitHubLabel { name: string }
interface GitHubRef { ref: string }
interface GitHubPullResponse {
  number: number
  title: string
  body: string | null
  head: GitHubRef
  base: GitHubRef
  state: string
  html_url: string
  created_at: string
  updated_at: string
  merged_at: string | null
  draft: boolean
  user: GitHubUser
  requested_reviewers?: GitHubUser[]
  assignees?: GitHubUser[]
  labels?: GitHubLabel[]
}

/**
 * Thrown when lockfile regeneration fails. Not a transient git error —
 * must bubble past the API fallback so we don't silently open a PR with
 * stale lockfiles.
 */
class LockfileRegenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LockfileRegenerationError'
  }
}

export class GitHubProvider implements GitProvider {
  /**
   * REST API base URL. Resolved once per instance from `GITHUB_API_URL` or an
   * explicit override, so the same code path serves github.com and GitHub
   * Enterprise Server.
   */
  private readonly apiUrl: string

  // In-memory cache for API responses (reduces redundant API calls within a single workflow run)
  private cache: {
    pullRequests: Map<string, { data: PullRequest[], timestamp: number }>
    issues: Map<string, { data: Issue[], timestamp: number }>
  } = {
    pullRequests: new Map(),
    issues: new Map(),
  }

  // Cache TTL in milliseconds. Kept short (2 minutes) because the cache is
  // per-instance: a different workflow run has its own cache anyway, so a long
  // TTL just risks serving stale data (e.g. missing a PR that another parallel
  // run just created). Duplicate-PR prevention is handled by the workflow-level
  // `concurrency:` group, not by extending this cache.
  private readonly cacheTTL = 2 * 60 * 1000

  /** Where this provider's progress output goes. */
  private readonly logger: Logger

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
    private readonly hasWorkflowPermissions: boolean = false,
    private readonly workflowToken?: string,
    /** Overrides the API base URL; defaults to the environment-derived value. */
    apiUrl?: string,
    /** Logger to use; defaults to the process-wide default. */
    logger?: Logger,
  ) {
    this.apiUrl = apiUrl ? apiUrl.replace(/\/+$/, '') : getGitHubApiUrl()
    this.logger = logger ?? getDefaultLogger()
  }

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.cacheTTL
  }

  /**
   * Clear all caches (useful when data is modified)
   */
  clearCache(): void {
    this.cache.pullRequests.clear()
    this.cache.issues.clear()
  }

  /**
   * Check if a branch exists in the repository
   */
  async branchExists(branchName: string): Promise<boolean> {
    try {
      await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/git/ref/heads/${branchName}`)
      return true
    }
    catch (error: any) {
      // 404 means branch doesn't exist
      if (error.message?.includes('404'))
        return false

      // For other errors, log and return false (conservative approach)
      this.logger.warn(`⚠️ Error checking branch ${branchName}: ${formatError(error)}`)
      return false
    }
  }

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

      this.logger.info(`✅ Created branch ${branchName} from ${baseBranch}`)
    }
    catch (error) {
      this.logger.error(`❌ Failed to create branch ${branchName}: ${formatError(error)}`)
      throw error
    }
  }

  async commitChanges(branchName: string, message: string, files: FileChange[], baseBranch: string = 'main'): Promise<void> {
    // Try Git CLI first for better compatibility with GitHub Actions permissions
    try {
      await this.commitChangesWithGit(branchName, message, files, baseBranch)
    }
    catch (gitError) {
      // Lockfile regeneration failures must NOT fall through to the API path —
      // the API path can't regenerate lockfiles either, so it would just produce
      // a PR with an updated manifest and stale lockfile. Bubble the error up.
      if (gitError instanceof LockfileRegenerationError || gitError instanceof FileChangeValidationError)
        throw gitError

      this.logger.warn(`⚠️ Git CLI commit failed, falling back to GitHub API: ${gitError}`)
      await this.commitChangesWithAPI(branchName, message, files, baseBranch)
    }
  }

  private async commitChangesWithGit(branchName: string, message: string, files: FileChange[], baseBranch: string = 'main'): Promise<void> {
    try {
      // Handle workflow files based on token permissions
      const workflowFiles = files.filter(f => f.path.includes('.github/workflows/'))
      const nonWorkflowFiles = files.filter(f => !f.path.includes('.github/workflows/'))

      if (workflowFiles.length > 0 && !this.hasWorkflowPermissions) {
        this.logger.warn(`⚠️ Detected ${workflowFiles.length} workflow file(s). These require elevated permissions.`)
        this.logger.warn(`⚠️ Workflow files: ${workflowFiles.map(f => f.path).join(', ')}`)
        this.logger.warn(`ℹ️ Workflow files will be skipped in this commit. BUDDY_BOT_TOKEN not detected or lacks workflow permissions.`)

        // If we have non-workflow files, commit just those
        if (nonWorkflowFiles.length > 0) {
          this.logger.info(`📝 Committing ${nonWorkflowFiles.length} non-workflow files...`)
          files = nonWorkflowFiles
        }
        else {
          this.logger.warn(`⚠️ All files are workflow files. No files will be committed in this PR.`)
          this.logger.warn(`💡 To update workflow files, ensure BUDDY_BOT_TOKEN is set with workflow:write permissions.`)
          // Don't return early - we'll create an empty commit to avoid "No commits between branches" error
          this.logger.info(`📝 Creating empty commit to avoid "No commits between branches" error...`)
          try {
            await this.runCommand('git', ['commit', '--allow-empty', '-m', 'Workflow files require elevated permissions - no changes committed'])
            this.logger.info(`✅ Created empty commit for workflow-only PR`)
          }
          catch (error) {
            this.logger.warn(`⚠️ Failed to create empty commit: ${error}`)
            // Try to create a minimal README update instead
            try {
              const readmePath = 'README.md'
              const readmeFile = Bun.file(readmePath)
              if (await readmeFile.exists()) {
                const content = await readmeFile.text()
                const updatedContent = `${content}\n\n<!-- Updated by Buddy Bot -->\n`
                await Bun.write(readmePath, updatedContent)
                await this.runCommand('git', ['add', readmePath])
                await this.runCommand('git', ['commit', '-m', 'Update README for workflow-only PR'])
                this.logger.info(`✅ Created README update for workflow-only PR`)
              }
            }
            catch (readmeError) {
              this.logger.error(`❌ Failed to create any commit: ${readmeError}`)
            }
          }
          return
        }
      }
      else if (workflowFiles.length > 0) {
        this.logger.info(`✅ Including ${workflowFiles.length} workflow file(s) with elevated permissions`)
      }

      // Configure Git identity to ensure github-actions[bot] attribution
      try {
        await this.runCommand('git', ['config', 'user.name', 'github-actions[bot]'])
        await this.runCommand('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
        this.logger.info('✅ Git identity configured for github-actions[bot]')
      }
      catch (error) {
        this.logger.warn('⚠️ Failed to configure Git identity:', error)
        // Continue anyway as it might already be configured
      }

      // Fetch latest changes
      await this.runCommand('git', ['fetch', 'origin'])

      // Renovate-style branch recreation: reset the PR branch to the base branch tip,
      // then apply dependency file changes fresh on top. This completely eliminates
      // merge conflicts because there's nothing to merge — we start from a clean base
      // and just write the dependency file changes on top.
      this.logger.info(`🔄 Recreating ${branchName} from origin/${baseBranch} (Renovate-style)...`)

      // Ensure we're on the PR branch (create if it doesn't exist)
      try {
        await this.runCommand('git', ['checkout', branchName])
      }
      catch {
        try {
          await this.runCommand('git', ['checkout', '-b', branchName, `origin/${branchName}`])
        }
        catch {
          await this.runCommand('git', ['checkout', '-b', branchName])
        }
      }

      // Reset the PR branch to the base branch tip — this is the key Renovate-style move.
      // Instead of merging main into the PR branch (which causes conflicts),
      // we simply point the branch at main's HEAD and apply our changes fresh.
      await this.runCommand('git', ['reset', '--hard', `origin/${baseBranch}`])
      await this.runCommand('git', ['clean', '-fd'])
      this.logger.info(`✅ Reset ${branchName} to origin/${baseBranch}`)

      await assertUpdateTargetsExist(files, async (cleanPath) => {
        try {
          await this.runCommand('git', ['cat-file', '-e', `origin/${baseBranch}:${cleanPath}`])
          return true
        }
        catch {
          return false
        }
      })

      // Apply file changes
      for (const file of files) {
        const cleanPath = normalizeRepositoryPath(file.path)

        // Safety check: prevent writing to sensitive files during tests
        if (process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test') {
          const sensitiveFiles = ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock']
          if (sensitiveFiles.includes(cleanPath) && file.content === '{"name":"x"}') {
            this.logger.warn(`⚠️ Skipping test file write to ${cleanPath} to prevent overwriting project files`)
            continue
          }
        }

        if (file.type === 'delete') {
          try {
            await this.runCommand('git', ['rm', cleanPath])
          }
          catch {
            // File might not exist, that's ok for delete operations
          }
        }
        else {
          // Bun.write creates parent directories automatically and is async
          await Bun.write(cleanPath, file.content)
          await this.runCommand('git', ['add', cleanPath])
        }
      }

      // Regenerate lock files after manifest changes (skip in test environments).
      // We HARD-FAIL if regeneration fails for any required manager: a PR with an
      // updated manifest but stale lockfile is a correctness bug — consumers will
      // install the wrong versions. Fail loudly so the caller can retry or
      // investigate instead of silently opening a broken PR.
      const isTestEnv = process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test'
      if (!isTestEnv) {
        const updatedPaths = files.map(f => f.path.replace(/^\.\//, '').replace(/^\/+/, ''))
        const requiredManagers = detectRequiredPackageManagers(updatedPaths)

        if (requiredManagers.length > 0) {
          this.logger.info(`🔒 Regenerating lock files for: ${requiredManagers.join(', ')}`)
          const cwd = process.cwd()
          const failures: string[] = []

          for (const manager of requiredManagers) {
            try {
              const result = await regenerateLockFile(manager, cwd)
              if (result.success) {
                // Stage any regenerated lock files
                for (const lockFile of getAllLockFilePaths()) {
                  try {
                    await this.runCommand('git', ['add', lockFile])
                  }
                  catch {
                    // Lock file may not exist for this manager, that's fine
                  }
                }
              }
              else {
                failures.push(`${manager}: ${result.message}`)
              }
            }
            catch (lockError) {
              failures.push(`${manager}: ${lockError instanceof Error ? lockError.message : String(lockError)}`)
            }
          }

          if (failures.length > 0) {
            const detail = failures.map(f => `  - ${f}`).join('\n')
            throw new LockfileRegenerationError(
              `Lock file regeneration failed; refusing to open PR with stale lockfiles.\n${detail}`,
            )
          }
        }
      }

      // Check if there are changes to commit against the current branch tip
      const status = await this.runCommand('git', ['status', '--porcelain'])
      if (status.trim()) {
        // Commit changes
        await this.runCommand('git', ['commit', '-m', message])

        // Force-push is required because we recreated the branch from base (Renovate-style).
        // Use --force-with-lease for safety — it will fail if someone else pushed to the
        // branch concurrently, preventing accidental overwrites.
        // Use workflow token for push if workflow files are included (needs elevated permissions).
        const pushToken = (workflowFiles.length > 0 && this.hasWorkflowPermissions)
          ? this.getEffectiveToken(true)
          : undefined
        await this.runCommand('git', ['push', 'origin', branchName, '--force-with-lease'], pushToken)

        this.logger.info(`✅ Successfully recreated ${branchName} with fresh changes from ${baseBranch}: ${message}`)
      }
      else {
        // SAFETY: Do NOT push when there are no file changes after resetting to base.
        // If we push now, the branch would be at the exact same commit as main,
        // and GitHub would auto-close the PR thinking it was merged.
        // This can happen when:
        //   1. The dependency changes were already merged to main
        //   2. commitChanges was called with an empty file list
        // In both cases, the right thing is to leave the branch alone.
        this.logger.info(`ℹ️ No file changes after resetting to ${baseBranch} — skipping push to prevent PR auto-close`)
      }
    }
    catch (error) {
      this.logger.error(`❌ Failed to commit changes to ${branchName} with Git CLI: ${formatError(error)}`)
      throw error
    }
  }

  private async commitChangesWithAPI(branchName: string, message: string, files: FileChange[], baseBranch: string = 'main'): Promise<void> {
    try {
      // Handle workflow files based on token permissions
      const workflowFiles = files.filter(f => f.path.includes('.github/workflows/'))
      const nonWorkflowFiles = files.filter(f => !f.path.includes('.github/workflows/'))

      if (workflowFiles.length > 0 && !this.hasWorkflowPermissions) {
        this.logger.warn(`⚠️ Detected ${workflowFiles.length} workflow file(s). These require elevated permissions.`)
        this.logger.warn(`⚠️ Workflow files: ${workflowFiles.map(f => f.path).join(', ')}`)
        this.logger.warn(`ℹ️ Workflow files will be skipped in this commit. Consider using a GitHub App with workflow permissions for workflow updates.`)

        // If we have non-workflow files, commit just those
        if (nonWorkflowFiles.length > 0) {
          this.logger.info(`📝 Committing ${nonWorkflowFiles.length} non-workflow files...`)
          files = nonWorkflowFiles
        }
        else {
          this.logger.warn(`⚠️ All files are workflow files. No files will be committed in this PR.`)
          this.logger.warn(`💡 To update workflow files, consider using a GitHub App with appropriate permissions.`)
          return // Exit early if no non-workflow files to commit
        }
      }
      else if (workflowFiles.length > 0) {
        this.logger.info(`✅ Including ${workflowFiles.length} workflow file(s) with elevated permissions`)
      }

      // Note: Lock files cannot be regenerated when committing via the API path
      // because there is no local filesystem to run install commands against.
      const hasManifestFiles = files.some(f =>
        f.path.endsWith('package.json') || f.path.endsWith('composer.json'),
      )
      if (hasManifestFiles) {
        this.logger.warn(`⚠️ Committing manifest files via API — lock files will not be updated.`)
        this.logger.warn(`   Lock file regeneration requires the Git CLI commit path (local filesystem).`)
      }

      // Renovate-style: base the new commit on the base branch (e.g. main), not the PR branch.
      // This recreates the branch from scratch, eliminating any merge conflicts.
      this.logger.info(`🔄 Recreating ${branchName} from ${baseBranch} via API (Renovate-style)...`)
      const baseRef = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/git/ref/heads/${baseBranch}`)
      const baseSha = baseRef.object.sha

      // Get base branch tree
      const baseCommit = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/git/commits/${baseSha}`)
      const baseTreeSha = baseCommit.tree.sha

      await assertUpdateTargetsExist(files, async (cleanPath) => {
        const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
        try {
          await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/contents/${encodedPath}?ref=${encodeURIComponent(baseBranch)}`)
          return true
        }
        catch (error: any) {
          if (error.message?.includes('404'))
            return false
          throw error
        }
      })

      // Create new tree with file changes
      const tree = []
      for (const file of files) {
        const cleanPath = normalizeRepositoryPath(file.path)

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
        base_tree: baseTreeSha,
        tree,
      })

      // SAFETY: If the tree matches base, the dependency changes are already in main.
      // Do NOT update the branch ref — pointing it at main's SHA would make GitHub
      // auto-close the PR thinking it was merged.
      if (newTree.sha === baseTreeSha) {
        this.logger.info(`ℹ️ No file changes relative to ${baseBranch} — skipping push to prevent PR auto-close`)
        return
      }

      // Create new commit parented to the base branch SHA (Renovate-style: single commit on top of base)
      const newCommit = await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/git/commits`, {
        message,
        tree: newTree.sha,
        parents: [baseSha],
        author: {
          name: 'github-actions[bot]',
          email: '41898282+github-actions[bot]@users.noreply.github.com',
        },
        committer: {
          name: 'github-actions[bot]',
          email: '41898282+github-actions[bot]@users.noreply.github.com',
        },
      })

      // Force-update branch reference (required since we're recreating from base branch)
      await this.apiRequest(`PATCH /repos/${this.owner}/${this.repo}/git/refs/heads/${branchName}`, {
        sha: newCommit.sha,
        force: true,
      })

      this.logger.info(`✅ Committed changes to ${branchName}: ${message}`)
    }
    catch (error) {
      this.logger.error(`❌ Failed to commit changes to ${branchName}: ${formatError(error)}`)
      throw error
    }
  }

  async createPullRequest(options: PullRequestOptions): Promise<PullRequest> {
    // Try GitHub CLI first as it might have better permission handling
    try {
      return await this.createPullRequestWithCLI(options)
    }
    catch (cliError) {
      this.logger.warn(`⚠️ GitHub CLI failed, falling back to API: ${cliError}`)
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
        this.logger.info(`🔍 Adding reviewers via CLI: ${options.reviewers.join(', ')}`)
        args.push('--reviewer', options.reviewers.join(','))
      }

      if (options.assignees && options.assignees.length > 0) {
        args.push('--assignee', options.assignees.join(','))
      }

      // Note: We don't add labels via CLI to avoid failures when labels don't exist
      // Labels will be added via API after PR creation if needed

      // Execute GitHub CLI command
      const result = await this.runCommand('gh', args)

      // Parse the PR URL from the output (GitHub CLI returns the PR URL)
      const prUrlMatch = result.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)
      if (!prUrlMatch) {
        throw new Error('Failed to parse PR number from GitHub CLI output')
      }

      const prNumber = Number.parseInt(prUrlMatch[1])
      const prUrl = prUrlMatch[0]

      this.logger.info(`✅ Created PR #${prNumber}: ${options.title}`)

      // Add labels via API after PR creation to handle missing labels gracefully
      if (options.labels && options.labels.length > 0) {
        try {
          await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/issues/${prNumber}/labels`, {
            labels: options.labels,
          })
          this.logger.info(`✅ Added labels to PR #${prNumber}: ${options.labels.join(', ')}`)
        }
        catch (labelError) {
          this.logger.warn(`⚠️ Failed to add labels: ${labelError}`)
          // Try to add labels one by one to handle missing labels gracefully
          for (const label of options.labels) {
            try {
              await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/issues/${prNumber}/labels`, {
                labels: [label],
              })
            }
            catch (singleLabelError) {
              this.logger.warn(`⚠️ Failed to add label '${label}': ${singleLabelError}`)
            }
          }
        }
      }

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
      this.logger.error(`❌ Failed to create PR with GitHub CLI: ${options.title}: ${formatError(error)}`)
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
          this.logger.info(`🔍 Adding reviewers to PR #${response.number}: ${options.reviewers.join(', ')}`)
          await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/pulls/${response.number}/requested_reviewers`, {
            reviewers: options.reviewers,
            team_reviewers: options.teamReviewers || [],
          })
          this.logger.info(`✅ Successfully added reviewers: ${options.reviewers.join(', ')}`)
        }
        catch (reviewerError) {
          this.logger.error(`❌ Failed to add reviewers: ${reviewerError}`)
          this.logger.error(`   Reviewers: ${options.reviewers.join(', ')}`)
          this.logger.error(`   Repository: ${this.owner}/${this.repo}`)
          this.logger.error(`   PR: #${response.number}`)
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
          this.logger.warn(`⚠️ Failed to add assignees: ${assigneeError}`)
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
          this.logger.warn(`⚠️ Failed to add labels: ${labelError}`)
          // Try to add labels one by one to handle missing labels gracefully
          for (const label of options.labels) {
            try {
              await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/issues/${response.number}/labels`, {
                labels: [label],
              })
            }
            catch (singleLabelError) {
              this.logger.warn(`⚠️ Failed to add label '${label}': ${singleLabelError}`)
            }
          }
        }
      }

      this.logger.info(`✅ Created PR #${response.number}: ${options.title}`)

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
      this.logger.error(`❌ Failed to create PR with API: ${options.title}: ${formatError(error)}`)
      throw error
    }
  }

  /**
   * Get the effective token for a given operation.
   * Uses the workflow token (PAT) for operations that need elevated permissions,
   * and the primary token (GITHUB_TOKEN) for everything else.
   */
  private getEffectiveToken(requireWorkflowPermissions = false): string {
    if (requireWorkflowPermissions && this.workflowToken)
      return this.workflowToken
    return this.token
  }

  /**
   * Run a command and return its output
   */
  async runCommand(command: string, args: string[], tokenOverride?: string): Promise<string> {
    const effectiveToken = tokenOverride || this.token
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'pipe',
        env: {
          ...process.env,
          GITHUB_TOKEN: effectiveToken,
          GH_TOKEN: effectiveToken,
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
          // Scrub any token-shaped strings (including the effective token itself)
          // before surfacing stderr — stderr is logged and can end up in CI output.
          reject(new Error(`Command failed with code ${code}: ${sanitizeStderr(stderr, effectiveToken)}`))
        }
      })

      child.on('error', (error) => {
        reject(error)
      })
    })
  }

  async getPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
    // Check cache first
    const cacheKey = `${state}`
    const cached = this.cache.pullRequests.get(cacheKey)
    if (cached && this.isCacheValid(cached.timestamp)) {
      this.logger.info(`📦 Using cached PRs (state: ${state}, ${cached.data.length} PRs)`)
      return cached.data
    }

    try {
      // GitHub caps per_page at 100. Repos with many buddy-bot PRs would
      // silently truncate at the first page, causing duplicate-PR creation
      // because lookup misses existing entries. Walk pages until we get a
      // short one, or cap after 20 pages (2000 PRs) as a sanity stop.
      const perPage = 100
      const maxPages = 20
      const all: GitHubPullResponse[] = []
      for (let page = 1; page <= maxPages; page++) {
        const response = await this.apiRequestWithRetry(
          `GET /repos/${this.owner}/${this.repo}/pulls?state=${state}&per_page=${perPage}&page=${page}`,
        ) as GitHubPullResponse[]
        if (!Array.isArray(response) || response.length === 0)
          break
        all.push(...response)
        if (response.length < perPage)
          break
      }

      const prs: PullRequest[] = all.map(pr => ({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? '',
        head: pr.head.ref,
        base: pr.base.ref,
        state: pr.state as PullRequest['state'],
        url: pr.html_url,
        createdAt: new Date(pr.created_at),
        updatedAt: new Date(pr.updated_at),
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
        author: pr.user.login,
        reviewers: pr.requested_reviewers?.map(r => r.login) ?? [],
        assignees: pr.assignees?.map(a => a.login) ?? [],
        labels: pr.labels?.map(l => l.name) ?? [],
        draft: pr.draft,
      }))

      // Cache the result
      this.cache.pullRequests.set(cacheKey, { data: prs, timestamp: Date.now() })
      this.logger.info(`✅ Fetched and cached ${prs.length} PRs (state: ${state})`)

      return prs
    }
    catch (error) {
      this.logger.error(`❌ Failed to get PRs: ${formatError(error)}`)
      throw error
    }
  }

  async updatePullRequest(prNumber: number, options: Partial<PullRequestOptions>): Promise<PullRequest> {
    // Invalidate PR cache since we're modifying data
    this.cache.pullRequests.clear()

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
          this.logger.info(`✅ Updated labels for PR #${prNumber}: ${options.labels.join(', ')}`)
        }
        catch (labelError) {
          this.logger.warn(`⚠️ Failed to update labels for PR #${prNumber}: ${labelError}`)
          // Try to add labels one by one to handle missing labels gracefully
          for (const label of options.labels) {
            try {
              await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/issues/${prNumber}/labels`, {
                labels: [label],
              })
            }
            catch (singleLabelError) {
              this.logger.warn(`⚠️ Failed to add label '${label}' to PR #${prNumber}: ${singleLabelError}`)
            }
          }
        }
      }

      // Update reviewers if specified
      if (options.reviewers && options.reviewers.length > 0) {
        try {
          this.logger.info(`🔍 Adding reviewers to existing PR #${prNumber}: ${options.reviewers.join(', ')}`)
          await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/pulls/${prNumber}/requested_reviewers`, {
            reviewers: options.reviewers,
            team_reviewers: options.teamReviewers || [],
          })
          this.logger.info(`✅ Updated reviewers for PR #${prNumber}: ${options.reviewers.join(', ')}`)
        }
        catch (reviewerError) {
          this.logger.error(`❌ Failed to update reviewers for PR #${prNumber}: ${reviewerError}`)
          this.logger.error(`   Reviewers: ${options.reviewers.join(', ')}`)
          this.logger.error(`   Repository: ${this.owner}/${this.repo}`)
        }
      }

      // Update assignees if specified
      if (options.assignees && options.assignees.length > 0) {
        try {
          // Use GitHub CLI for assignees (more reliable with permissions)
          await this.runCommand('gh', ['issue', 'edit', prNumber.toString(), '--add-assignee', options.assignees.join(',')])
          this.logger.info(`✅ Updated assignees for PR #${prNumber}: ${options.assignees.join(', ')}`)
        }
        catch (assigneeError) {
          this.logger.warn(`⚠️ Failed to update assignees for PR #${prNumber}: ${assigneeError}`)
        }
      }

      this.logger.info(`✅ Updated PR #${prNumber}`)

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
      this.logger.error(`❌ Failed to update PR #${prNumber}: ${formatError(error)}`)
      throw error
    }
  }

  async closePullRequest(prNumber: number): Promise<void> {
    // Invalidate PR cache since we're modifying data
    this.cache.pullRequests.clear()

    try {
      await this.apiRequest(`PATCH /repos/${this.owner}/${this.repo}/pulls/${prNumber}`, {
        state: 'closed',
      })
      this.logger.info(`✅ Closed PR #${prNumber}`)
      // NOTE: Branch cleanup is the caller's responsibility.
      // Automatically deleting the branch here prevents reopening PRs later.
    }
    catch (error) {
      this.logger.error(`❌ Failed to close PR #${prNumber}: ${formatError(error)}`)
      throw error
    }
  }

  async reopenPullRequest(prNumber: number): Promise<void> {
    // Invalidate PR cache since we're modifying data
    this.cache.pullRequests.clear()

    try {
      await this.apiRequest(`PATCH /repos/${this.owner}/${this.repo}/pulls/${prNumber}`, {
        state: 'open',
      })
      this.logger.info(`✅ Reopened PR #${prNumber}`)
    }
    catch (error) {
      this.logger.error(`❌ Failed to reopen PR #${prNumber}: ${formatError(error)}`)
      throw error
    }
  }

  async createComment(prNumber: number, comment: string): Promise<void> {
    try {
      await this.apiRequest(`POST /repos/${this.owner}/${this.repo}/issues/${prNumber}/comments`, {
        body: comment,
      })
      this.logger.info(`💬 Added comment to PR #${prNumber}`)
    }
    catch (error) {
      this.logger.error(`❌ Failed to add comment to PR #${prNumber}: ${formatError(error)}`)
      throw error
    }
  }

  async mergePullRequest(prNumber: number, strategy: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<void> {
    try {
      const mergeMethod = strategy === 'rebase' ? 'rebase' : strategy === 'squash' ? 'squash' : 'merge'

      // Get PR details to know the branch name for cleanup
      const prDetails = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/pulls/${prNumber}`)
      const branchName = prDetails.head.ref

      await this.apiRequest(`PUT /repos/${this.owner}/${this.repo}/pulls/${prNumber}/merge`, {
        merge_method: mergeMethod,
      })

      this.logger.info(`✅ Merged PR #${prNumber} using ${strategy}`)

      // Clean up the branch after successful merge
      try {
        await this.deleteBranch(branchName)
        this.logger.info(`🧹 Cleaned up branch ${branchName} after merge`)
      }
      catch (cleanupError) {
        this.logger.warn(`⚠️ Failed to clean up branch ${branchName}:`, cleanupError)
      }
    }
    catch (error) {
      this.logger.error(`❌ Failed to merge PR #${prNumber}: ${formatError(error)}`)
      throw error
    }
  }

  /**
   * Ask GitHub to merge a pull request itself once its required checks pass.
   *
   * This is the preferred auto-merge path: GitHub owns the waiting, so a
   * workflow run doesn't have to poll. It only works on repositories that
   * have auto-merge enabled and at least one required check — without those,
   * the mutation fails and the caller should fall back to merging directly
   * once checks are observed green.
   *
   * @param prNumber - Pull request to queue
   * @param strategy - Merge method to use
   * @returns `true` when GitHub accepted the request, `false` when the
   * repository cannot queue it (branch protection or auto-merge not set up)
   * @throws {GitHubApiError} When the API call itself fails
   */
  async enableAutoMerge(prNumber: number, strategy: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<boolean> {
    const pr = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/pulls/${prNumber}`)
    const mutation = `mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
      enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
        pullRequest { number }
      }
    }`

    const response = await this.graphqlRequest(mutation, {
      pullRequestId: pr.node_id,
      mergeMethod: strategy.toUpperCase(),
    })

    if (response.errors?.length) {
      // "Pull request is in clean status" means there is nothing to wait for,
      // so GitHub refuses to queue it. That is a fallback signal, not a bug.
      const message = response.errors.map((error: { message: string }) => error.message).join('; ')
      this.logger.info(`ℹ️ GitHub could not queue auto-merge for PR #${prNumber}: ${message}`)
      return false
    }

    this.logger.success(`✅ Auto-merge queued for PR #${prNumber} (${strategy})`)
    return true
  }

  /**
   * Aggregate state of the checks and commit statuses on a PR's head commit.
   *
   * @param prNumber - Pull request to inspect
   * @returns `'success'` when everything passed, `'failure'` when anything
   * failed, `'pending'` while work is outstanding, and `'none'` when the
   * repository reports no checks at all
   */
  async getPullRequestChecksState(prNumber: number): Promise<'success' | 'failure' | 'pending' | 'none'> {
    try {
      const pr = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/pulls/${prNumber}`)
      const ref = pr.head.sha

      const [status, checks] = await Promise.all([
        this.apiRequest(`GET /repos/${this.owner}/${this.repo}/commits/${ref}/status`),
        this.apiRequest(`GET /repos/${this.owner}/${this.repo}/commits/${ref}/check-runs?per_page=100`),
      ])

      const runs: Array<{ status: string, conclusion: string | null }> = checks?.check_runs ?? []
      const hasLegacyStatuses = (status?.statuses?.length ?? 0) > 0

      if (runs.length === 0 && !hasLegacyStatuses)
        return 'none'

      const failed = runs.some(run =>
        run.conclusion !== null
        && ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion),
      )
      if (failed || status?.state === 'failure' || status?.state === 'error')
        return 'failure'

      const running = runs.some(run => run.status !== 'completed')
      if (running || status?.state === 'pending')
        return 'pending'

      return 'success'
    }
    catch (error) {
      // An unreadable check state must not be mistaken for a green one.
      this.logger.warn(`⚠️ Could not read check state for PR #${prNumber}: ${formatError(error)}`)
      return 'pending'
    }
  }

  /**
   * Issue a GraphQL request against the configured GitHub API.
   *
   * Errors are returned in the payload rather than thrown, because GraphQL
   * reports business-level refusals (such as a PR not being auto-mergeable)
   * with HTTP 200 and an `errors` array.
   */
  private async graphqlRequest(query: string, variables: Record<string, unknown>): Promise<any> {
    const response = await fetchWithTimeout(`${this.apiUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'buddy-bot',
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new GitHubApiError(
        `GraphQL request failed: ${response.status} ${response.statusText}`,
        response.status,
        'POST',
        `${this.apiUrl}/graphql`,
        `${this.owner}/${this.repo}`,
      )
    }

    return await response.json()
  }

  /**
   * Delete a branch using pure git commands (no API calls)
   */
  async deleteBranch(branchName: string): Promise<void> {
    try {
      // Use pure git to delete the remote branch (no API calls!)
      await this.runCommand('git', ['push', 'origin', '--delete', branchName])
      this.logger.info(`✅ Deleted branch ${branchName} via git`)
    }
    catch (error) {
      // If git push fails, it might be because the branch doesn't exist remotely
      // or we don't have push permissions. Try to delete locally and ignore errors.
      try {
        // Also delete local tracking branch if it exists
        await this.runCommand('git', ['branch', '-D', branchName])
        this.logger.info(`✅ Deleted local branch ${branchName}`)
      }
      catch {
        // Ignore local deletion errors - branch might not exist locally
      }

      this.logger.warn(`⚠️ Failed to delete remote branch ${branchName}: ${formatError(error)}`)
      // Don't throw - branch deletion failures are not critical
    }
  }

  /**
   * Get all buddy-bot branches from the repository using local git commands
   */
  async getBuddyBotBranches(): Promise<Array<{ name: string, sha: string, lastCommitDate: Date }>> {
    try {
      // Use local git to get all remote branches
      const remoteBranchesOutput = await this.runCommand('git', ['branch', '-r', '--format=%(refname:short) %(objectname) %(committerdate:iso8601)'])

      const branches: Array<{ name: string, sha: string, lastCommitDate: Date }> = []

      for (const line of remoteBranchesOutput.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed)
          continue

        const parts = trimmed.split(' ')
        if (parts.length < 3)
          continue

        const fullBranchName = parts[0] // e.g., "origin/buddy-bot/update-deps"
        const sha = parts[1]
        const dateStr = parts.slice(2).join(' ') // Join back in case date has spaces

        // Extract just the branch name without remote prefix
        const branchName = fullBranchName.replace(/^origin\//, '')

        // Only include buddy-bot branches
        if (!branchName.startsWith('buddy-bot/'))
          continue

        try {
          const lastCommitDate = new Date(dateStr)
          branches.push({
            name: branchName,
            sha,
            lastCommitDate,
          })
        }
        catch {
          this.logger.warn(`⚠️ Failed to parse date for branch ${branchName}: ${dateStr}`)
          branches.push({
            name: branchName,
            sha,
            lastCommitDate: new Date(0), // Fallback to epoch
          })
        }
      }

      this.logger.info(`🔍 Found ${branches.length} buddy-bot branches using local git`)
      return branches
    }
    catch (error) {
      this.logger.warn('⚠️ Failed to fetch buddy-bot branches via git, falling back to API:', error)

      // Fallback to API method if git fails
      return this.getBuddyBotBranchesViaAPI()
    }
  }

  /**
   * Fallback method to get buddy-bot branches via API (original implementation)
   */
  private async getBuddyBotBranchesViaAPI(): Promise<Array<{ name: string, sha: string, lastCommitDate: Date }>> {
    try {
      // Fetch all branches with pagination
      let allBranches: any[] = []
      let page = 1
      const perPage = 100

      while (true) {
        const branches = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/branches?per_page=${perPage}&page=${page}`)

        if (!branches || branches.length === 0) {
          break
        }

        allBranches = allBranches.concat(branches)

        // If we got less than perPage results, we've reached the end
        if (branches.length < perPage) {
          break
        }

        page++
      }

      this.logger.info(`🔍 Found ${allBranches.length} total branches in repository`)

      // Filter for buddy-bot branches
      const buddyBranches = allBranches.filter((branch: any) => branch.name.startsWith('buddy-bot/'))
      this.logger.info(`🤖 Found ${buddyBranches.length} buddy-bot branches`)

      // Get detailed info for each branch including last commit date
      const branchDetails = await Promise.all(
        buddyBranches.map(async (branch: any) => {
          try {
            const commit = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/commits/${branch.commit.sha}`)
            return {
              name: branch.name,
              sha: branch.commit.sha,
              lastCommitDate: new Date(commit.commit.committer.date),
            }
          }
          catch (error) {
            this.logger.warn(`⚠️ Failed to get commit info for branch ${branch.name}: ${formatError(error)}`)
            return {
              name: branch.name,
              sha: branch.commit.sha,
              lastCommitDate: new Date(0), // Fallback to epoch
            }
          }
        }),
      )

      return branchDetails
    }
    catch (error) {
      this.logger.warn('⚠️ Failed to fetch buddy-bot branches:', error)
      return []
    }
  }

  /**
   * Get all buddy-bot branches that don't have associated open PRs
   */
  async getOrphanedBuddyBotBranches(): Promise<Array<{ name: string, sha: string, lastCommitDate: Date }>> {
    try {
      const buddyBranches = await this.getBuddyBotBranches()

      const prBranches = await this.getOpenPRBranches()

      // Filter out branches that have active PRs
      const orphanedBranches = buddyBranches.filter(branch => !prBranches.has(branch.name))

      return orphanedBranches
    }
    catch (error) {
      this.logger.warn('⚠️ Failed to identify orphaned branches:', error)
      return []
    }
  }

  /**
   * Tracks whether the most recent open-PR detection succeeded authoritatively
   * (via the GitHub API). Consumed by cleanupStaleBranches to decide between
   * "delete every orphan" and "fall back to age-based protection".
   */
  private prDetectionSuccessful = false

  /**
   * Get the set of buddy-bot branches that currently have open PRs.
   *
   * Uses the GitHub REST API as the authoritative source. Earlier versions
   * scraped the PR HTML page for `State--open` CSS classes, which silently
   * broke when GitHub removed those classes — every open PR was misreported
   * as closed, causing cleanupStaleBranches to delete the live PR's branch
   * (which in turn auto-closed the PR).
   */
  private async getOpenPRBranches(): Promise<Set<string>> {
    this.prDetectionSuccessful = false

    try {
      const openPRs = await this.getPullRequests('open')
      const protectedBranches = new Set<string>(
        openPRs
          .map(pr => pr.head)
          .filter(head => head.startsWith('buddy-bot/')),
      )

      this.logger.info(`🔍 GitHub API reports ${openPRs.length} open PR(s); ${protectedBranches.size} are buddy-bot branches`)
      this.logger.info(`🛡️ Protecting ${protectedBranches.size} branches with confirmed open PRs`)
      this.prDetectionSuccessful = true
      return protectedBranches
    }
    catch (error) {
      this.logger.warn('⚠️ Failed to fetch open PRs via API, falling back to age-based protection:', error)

      // Conservative fallback: protect branches less than 30 days old
      try {
        const allBuddyBranches = await this.getBuddyBotBranches()
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

        const conservativeBranches = new Set<string>()
        for (const branch of allBuddyBranches) {
          if (branch.lastCommitDate > thirtyDaysAgo) {
            conservativeBranches.add(branch.name)
          }
        }

        this.logger.info(`🛡️ Conservative fallback: protecting ${conservativeBranches.size} branches newer than 30 days`)
        return conservativeBranches
      }
      catch {
        // Ultimate fallback: leave prDetectionSuccessful=false so cleanupStaleBranches
        // applies its age-based filter against whatever branches it can enumerate.
        this.logger.info('⚠️ Could not enumerate branches for age-based fallback')
        return new Set<string>()
      }
    }
  }

  /**
   * Clean up orphaned buddy-bot branches (with optional age filter for fallback scenarios)
   */
  async cleanupStaleBranches(olderThanDays = 7, dryRun = false): Promise<{ deleted: string[], failed: string[] }> {
    this.logger.info(`🔍 Looking for buddy-bot branches without open PRs...`)

    const orphanedBranches = await this.getOrphanedBuddyBotBranches()
    this.logger.info(`🔍 Found ${orphanedBranches.length} orphaned buddy-bot branches (no associated open PRs)`)

    // When PR detection succeeded authoritatively, every orphan is a true orphan.
    // If detection fell back to age-based protection, only delete branches older
    // than the configured threshold to avoid wiping out branches whose live PRs
    // we couldn't verify.
    let branchesToDelete = orphanedBranches

    if (this.prDetectionSuccessful) {
      this.logger.info(`🎯 PR detection successful - cleaning up ALL ${branchesToDelete.length} orphaned branches (any age)`)
    }
    else {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)
      branchesToDelete = orphanedBranches.filter(branch => branch.lastCommitDate < cutoffDate)
      this.logger.info(`⚠️ PR detection failed - only deleting branches older than ${olderThanDays} days`)
      this.logger.info(`🔍 Found ${branchesToDelete.length} stale buddy-bot branches (older than ${olderThanDays} days)`)
    }

    // Show some examples of what we found
    if (branchesToDelete.length > 0) {
      this.logger.info('📋 Sample of branches to delete:')
      branchesToDelete.slice(0, 5).forEach((branch) => {
        const daysOld = Math.floor((Date.now() - branch.lastCommitDate.getTime()) / (1000 * 60 * 60 * 24))
        this.logger.info(`  - ${branch.name} (${daysOld} days old)`)
      })
      if (branchesToDelete.length > 5) {
        this.logger.info(`  ... and ${branchesToDelete.length - 5} more`)
      }
    }

    if (branchesToDelete.length === 0) {
      this.logger.info('✅ No branches to clean up!')
      return { deleted: [], failed: [] }
    }

    const staleBranches = branchesToDelete

    if (dryRun) {
      this.logger.info('🔍 [DRY RUN] Would delete the following branches:')
      staleBranches.forEach((branch) => {
        const daysOld = Math.floor((Date.now() - branch.lastCommitDate.getTime()) / (1000 * 60 * 60 * 24))
        this.logger.info(`  - ${branch.name} (${daysOld} days old, last commit: ${branch.lastCommitDate.toISOString()})`)
      })
      return { deleted: staleBranches.map(b => b.name), failed: [] }
    }

    const deleted: string[] = []
    const failed: string[] = []

    this.logger.info(`🧹 Cleaning up ${staleBranches.length} stale branches...`)

    // Delete branches in smaller batches with longer delays to avoid rate limiting
    const batchSize = 5 // Reduced from 10 to be more conservative
    for (let i = 0; i < staleBranches.length; i += batchSize) {
      const batch = staleBranches.slice(i, i + batchSize)
      const batchNumber = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(staleBranches.length / batchSize)

      this.logger.info(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} branches)`)

      // Process branches sequentially within batch to avoid overwhelming the API
      for (const branch of batch) {
        try {
          await this.deleteBranch(branch.name)
          deleted.push(branch.name)
          this.logger.info(`✅ Deleted: ${branch.name}`)
        }
        catch (error) {
          failed.push(branch.name)
          this.logger.warn(`❌ Failed to delete ${branch.name}: ${formatError(error)}`)
        }

        // Small delay between individual deletions within batch
        await new Promise(resolve => setTimeout(resolve, 200))
      }

      // Longer delay between batches to be respectful of API limits
      if (i + batchSize < staleBranches.length) {
        const delay = 3000 // 3 seconds between batches
        this.logger.info(`⏳ Waiting ${delay / 1000} seconds before next batch...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    this.logger.info(`🎉 Cleanup complete!`)
    this.logger.info(`  ✅ Successfully deleted: ${deleted.length} branches`)
    this.logger.info(`  ❌ Failed to delete: ${failed.length} branches`)

    if (failed.length > 0) {
      this.logger.info('❌ Failed branches:')
      failed.forEach(branch => this.logger.info(`  - ${branch}`))
    }

    return { deleted, failed }
  }

  /**
   * Make an authenticated API request to GitHub.
   *
   * @param endpoint - `METHOD /path` pair, e.g. `GET /repos/o/r/pulls`
   * @param data - JSON body, sent only for POST/PATCH/PUT
   * @param tokenOverride - Use a different token than the instance default
   * @param retries - Transport-level retry attempts for rate limits
   * @throws {GitHubApiError} On any non-2xx response
   */
  private async apiRequest(endpoint: string, data?: any, tokenOverride?: string, retries = 0): Promise<any> {
    const [method, path] = endpoint.split(' ')
    const url = `${this.apiUrl}${path}`
    const effectiveToken = tokenOverride || this.token

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${effectiveToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'buddy-bot',
      },
    }

    if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      options.body = JSON.stringify(data)
    }

    const response = await fetchWithTimeout(url, {
      ...options,
      retries,
      onRetry: ({ delayMs, reason }) =>
        this.logger.info(`⏳ ${reason} on ${method} ${path}, retrying in ${Math.round(delayMs / 1000)}s...`),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      const tokenHint = effectiveToken
        ? 'token present ([REDACTED])'
        : 'NO TOKEN — ensure GITHUB_TOKEN or BUDDY_BOT_TOKEN is set'
      throw new GitHubApiError(
        `GitHub API error: ${response.status} ${response.statusText}\n`
        + `  URL: ${method} ${url}\n`
        + `  Auth: ${tokenHint}\n`
        + `  Repo: ${this.owner}/${this.repo}\n`
        + `${errorBody}`,
        response.status,
        method,
        url,
        `${this.owner}/${this.repo}`,
        errorBody,
      )
    }

    if (response.headers.get('content-type')?.includes('application/json')) {
      return response.json()
    }

    return response.text()
  }

  /**
   * Make an authenticated API request, retrying through rate limits.
   *
   * Retry now lives in the transport, which can read `Retry-After` and
   * `x-ratelimit-reset` off the response instead of guessing a backoff from
   * the error message — and which will not replay a POST that the server may
   * already have acted on.
   *
   * @param endpoint - `METHOD /path` pair
   * @param data - JSON body, sent only for POST/PATCH/PUT
   * @param maxRetries - Total attempts allowed, including the first
   */
  private async apiRequestWithRetry(endpoint: string, data?: any, maxRetries = 3): Promise<any> {
    return this.apiRequest(endpoint, data, undefined, Math.max(0, maxRetries - 1))
  }

  async createIssue(options: IssueOptions): Promise<Issue> {
    // Invalidate issue cache since we're creating new data
    this.cache.issues.clear()

    try {
      const response = await this.apiRequestWithRetry(`POST /repos/${this.owner}/${this.repo}/issues`, {
        title: options.title,
        body: options.body,
        assignees: options.assignees || [],
        labels: options.labels || [],
        milestone: options.milestone,
      })

      this.logger.info(`✅ Created issue #${response.number}: ${options.title}`)

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
      this.logger.error(`❌ Failed to create issue: ${options.title}: ${formatError(error)}`)
      throw error
    }
  }

  async getIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
    // Check cache first
    const cacheKey = `${state}`
    const cached = this.cache.issues.get(cacheKey)
    if (cached && this.isCacheValid(cached.timestamp)) {
      this.logger.info(`📦 Using cached issues (state: ${state}, ${cached.data.length} issues)`)
      return cached.data
    }

    try {
      // Paginate — without this, the dashboard issue can be missed on repos
      // with 100+ open issues, causing duplicate dashboard creation.
      const perPage = 100
      const maxPages = 20
      const all: any[] = []
      for (let page = 1; page <= maxPages; page++) {
        const response = await this.apiRequestWithRetry(
          `GET /repos/${this.owner}/${this.repo}/issues?state=${state}&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
        )
        if (!Array.isArray(response) || response.length === 0)
          break
        all.push(...response)
        if (response.length < perPage)
          break
      }

      const issues = all
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

      // Cache the result
      this.cache.issues.set(cacheKey, { data: issues, timestamp: Date.now() })
      this.logger.info(`✅ Fetched and cached ${issues.length} issues (state: ${state})`)

      return issues
    }
    catch (error) {
      this.logger.error('❌ Failed to get issues:', error)
      throw error
    }
  }

  async updateIssue(issueNumber: number, options: Partial<IssueOptions>): Promise<Issue> {
    // Invalidate issue cache since we're modifying data
    this.cache.issues.clear()

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

      const response = await this.apiRequestWithRetry(`PATCH /repos/${this.owner}/${this.repo}/issues/${issueNumber}`, updateData)

      this.logger.info(`✅ Updated issue #${issueNumber}: ${response.title}`)

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
      this.logger.error(`❌ Failed to update issue #${issueNumber}: ${formatError(error)}`)
      throw error
    }
  }

  async closeIssue(issueNumber: number): Promise<void> {
    // Invalidate issue cache since we're modifying data
    this.cache.issues.clear()

    try {
      await this.apiRequestWithRetry(`PATCH /repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
        state: 'closed',
      })

      this.logger.info(`✅ Closed issue #${issueNumber}`)
    }
    catch (error) {
      this.logger.error(`❌ Failed to close issue #${issueNumber}: ${formatError(error)}`)
      throw error
    }
  }

  /**
   * Pin an issue to the top of the repository's issue list.
   *
   * Pinning is a GraphQL-only operation — the REST API has no endpoint for it.
   * GitHub allows at most three pinned issues per repository; exceeding that
   * is reported as a failure and logged rather than thrown, since a dashboard
   * that failed to pin is still a usable dashboard.
   *
   * @param issueNumber - Issue to pin
   * @returns `true` when the issue is now pinned
   */
  async pinIssue(issueNumber: number): Promise<boolean> {
    return await this.setIssuePinned(issueNumber, true)
  }

  /**
   * Remove an issue from the repository's pinned list.
   *
   * @param issueNumber - Issue to unpin
   * @returns `true` when the issue is no longer pinned
   */
  async unpinIssue(issueNumber: number): Promise<boolean> {
    return await this.setIssuePinned(issueNumber, false)
  }

  private async setIssuePinned(issueNumber: number, pinned: boolean): Promise<boolean> {
    const action = pinned ? 'pin' : 'unpin'
    try {
      const issue = await this.apiRequest(`GET /repos/${this.owner}/${this.repo}/issues/${issueNumber}`)
      const mutation = pinned
        ? `mutation($issueId: ID!) { pinIssue(input: { issueId: $issueId }) { issue { number } } }`
        : `mutation($issueId: ID!) { unpinIssue(input: { issueId: $issueId }) { issue { number } } }`

      const response = await this.graphqlRequest(mutation, { issueId: issue.node_id })

      if (response.errors?.length) {
        const message = response.errors.map((error: { message: string }) => error.message).join('; ')
        this.logger.info(`⚠️ Failed to ${action} issue #${issueNumber}: ${message}`)
        return false
      }

      this.logger.info(`📌 ${pinned ? 'Pinned' : 'Unpinned'} issue #${issueNumber}`)
      return true
    }
    catch (error) {
      // Pinning is cosmetic — never fail a dashboard run over it.
      this.logger.info(`⚠️ Failed to ${action} issue #${issueNumber}: ${formatError(error)}`)
      return false
    }
  }
}
