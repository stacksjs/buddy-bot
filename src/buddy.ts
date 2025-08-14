/* eslint-disable no-console */
import type {
  BuddyBotConfig,
  DashboardData,
  Issue,
  PackageFile,
  PackageUpdate,
  PullRequest,
  UpdateGroup,
  UpdateScanResult,
} from './types'
import fs from 'node:fs'
import process from 'node:process'
import { DashboardGenerator } from './dashboard/dashboard-generator'
import { GitHubProvider } from './git/github-provider'
import { PullRequestGenerator } from './pr/pr-generator'
import { RegistryClient } from './registry/registry-client'
import { PackageScanner } from './scanner/package-scanner'
import { DeprecatedDependenciesChecker } from './services/deprecated-dependencies-checker'
import { groupUpdates, sortUpdatesByPriority } from './utils/helpers'
import { Logger } from './utils/logger'

export class Buddy {
  private readonly logger: Logger
  private readonly scanner: PackageScanner
  private readonly registryClient: RegistryClient
  private readonly dashboardGenerator: DashboardGenerator

  constructor(
    private readonly config: BuddyBotConfig,
    private readonly projectPath: string = process.cwd(),
  ) {
    this.logger = new Logger(config.verbose ?? false)
    this.scanner = new PackageScanner(this.projectPath, this.logger, this.config.packages?.ignorePaths)
    this.registryClient = new RegistryClient(this.projectPath, this.logger, this.config)
    this.dashboardGenerator = new DashboardGenerator()
  }

  /**
   * Scan for dependency updates
   */
  async scanForUpdates(): Promise<UpdateScanResult> {
    const startTime = Date.now()
    this.logger.info('Starting dependency update scan...')

    try {
      // Scan for package files
      const packageFiles = await this.scanner.scanProject()
      const totalPackages = packageFiles.reduce((sum, file) => sum + file.dependencies.length, 0)

      // Get outdated packages from package.json using bun outdated
      let packageJsonUpdates: PackageUpdate[] = []

      if (this.config.packages?.ignore && this.config.packages.ignore.length > 0) {
        // Get all updates first, then filter
        const allUpdates = await this.registryClient.getOutdatedPackages()
        packageJsonUpdates = allUpdates.filter(update => !this.config.packages!.ignore!.includes(update.name))
      }
      else {
        packageJsonUpdates = await this.registryClient.getOutdatedPackages()
      }

      // Get outdated packages from dependency files using ts-pkgx
      const dependencyFileUpdates = await this.checkDependencyFilesForUpdates(packageFiles)

      // Get outdated GitHub Actions
      const githubActionsUpdates = await this.checkGitHubActionsForUpdates(packageFiles)

      // Merge all updates
      let updates = [...packageJsonUpdates, ...dependencyFileUpdates, ...githubActionsUpdates]

      // Apply ignore filter to dependency file updates
      if (this.config.packages?.ignore && this.config.packages.ignore.length > 0) {
        updates = updates.filter(update => !this.config.packages!.ignore!.includes(update.name))
      }

      // Apply update strategy filtering
      if (this.config.packages?.strategy) {
        updates = this.filterUpdatesByStrategy(updates, this.config.packages.strategy)
      }

      // Sort updates by priority
      updates = sortUpdatesByPriority(updates)

      // Group updates
      const groups = this.config.packages?.groups
        ? this.groupUpdatesByConfig(updates)
        : groupUpdates(updates)

      const scanDuration = Date.now() - startTime

      const result: UpdateScanResult = {
        totalPackages,
        updates,
        groups,
        scannedAt: new Date(),
        duration: scanDuration,
      }

      this.logger.success(`Scan completed in ${scanDuration}ms. Found ${updates.length} updates.`)
      return result
    }
    catch (error) {
      this.logger.error('Failed to scan for updates:', error)
      throw error
    }
  }

  /**
   * Create pull requests for updates
   */
  async createPullRequests(scanResult: UpdateScanResult): Promise<void> {
    this.logger.info('Creating pull requests for updates...')

    try {
      // Check if repository is configured
      if (!this.config.repository) {
        this.logger.error('❌ Repository configuration required for PR creation')
        this.logger.info('Configure repository.provider, repository.owner, repository.name in buddy-bot.config.ts')
        return
      }

      // Get GitHub token from environment (prefer BUDDY_BOT_TOKEN for full permissions)
      const token = process.env.BUDDY_BOT_TOKEN || process.env.GITHUB_TOKEN
      if (!token) {
        this.logger.error('❌ GITHUB_TOKEN or BUDDY_BOT_TOKEN environment variable required for PR creation')
        return
      }

      // Determine if we have workflow permissions (BUDDY_BOT_TOKEN has full permissions)
      const hasWorkflowPermissions = !!process.env.BUDDY_BOT_TOKEN

      if (process.env.BUDDY_BOT_TOKEN) {
        console.log('✅ BUDDY_BOT_TOKEN detected - workflow permissions enabled')
        console.log(`🔑 Token length: ${process.env.BUDDY_BOT_TOKEN.length} characters`)
      }
      else {
        console.log('⚠️ BUDDY_BOT_TOKEN not found - workflow permissions disabled')
        console.log('💡 Ensure BUDDY_BOT_TOKEN is properly configured in GitHub secrets')
        // eslint-disable-next-line no-template-curly-in-string
        console.log('💡 The workflow should set: env: BUDDY_BOT_TOKEN: ${{ secrets.BUDDY_BOT_TOKEN }}')
      }

      // Initialize GitHub provider
      const gitProvider = new GitHubProvider(
        token,
        this.config.repository.owner,
        this.config.repository.name,
        hasWorkflowPermissions,
      )

      // Initialize PR generator with config
      const prGenerator = new PullRequestGenerator(this.config)

      // Process each group
      for (const group of scanResult.groups) {
        try {
          this.logger.info(`Creating PR for group: ${group.name} (${group.updates.length} updates)`)

          // Generate PR content first to check for existing PRs
          const prTitle = group.title
          const prBody = await prGenerator.generateBody(group)

          // Check for existing open PRs with similar content
          const existingPRs = await gitProvider.getPullRequests('open')
          const branchPattern = `buddy-bot/update-${group.name.toLowerCase().replace(/\s+/g, '-')}-`

          const existingPR = existingPRs.find(pr =>
            (pr.title === prTitle
              || pr.head.startsWith(branchPattern)
              || this.isSimilarPRTitle(pr.title, prTitle))
            && (pr.author === 'github-actions[bot]' || pr.author.includes('buddy') || pr.head.startsWith('buddy-bot/'))
            && !pr.head.includes('renovate/') // Exclude Renovate PRs
            && !pr.head.includes('dependabot/') // Exclude Dependabot PRs
            && !pr.author.toLowerCase().includes('renovate') // Exclude Renovate bot
            && !pr.author.toLowerCase().includes('dependabot'), // Exclude Dependabot bot
          )

          if (existingPR) {
            this.logger.info(`🔄 Found existing PR #${existingPR.number}: ${existingPR.title}`)

            // Check if this PR should be auto-closed due to respectLatest config changes
            const shouldAutoClose = this.shouldAutoClosePR(existingPR, group.updates)
            if (shouldAutoClose) {
              this.logger.info(`🔒 Auto-closing PR #${existingPR.number} due to respectLatest config change`)
              try {
                await gitProvider.closePullRequest(existingPR.number)
                await gitProvider.deleteBranch(existingPR.head)
                this.logger.success(`✅ Auto-closed PR #${existingPR.number} and deleted branch ${existingPR.head}`)
                continue
              }
              catch (error) {
                this.logger.error(`❌ Failed to auto-close PR #${existingPR.number}:`, error)
                // Continue with normal PR creation if auto-close fails
              }
            }

            // Check if the updates are the same by comparing package lists
            const existingUpdatesMatch = this.checkIfUpdatesMatch(existingPR.body, group.updates)

            if (existingUpdatesMatch) {
              this.logger.info(`✅ Existing PR has the same updates, skipping creation`)
              continue
            }
            else {
              this.logger.info(`🔄 Updates differ, will update existing PR with new content`)

              // Get the existing branch name from the PR
              const existingBranchName = existingPR.head

              // Ensure we're on a clean main branch before generating updates
              // This prevents reading modified files from previous PR generations
              try {
                const { spawn } = await import('node:child_process')
                const runGitCommand = (command: string, args: string[]): Promise<void> => {
                  return new Promise((resolve, reject) => {
                    const child = spawn(command, args, { stdio: 'pipe' })
                    child.on('close', (code) => {
                      if (code === 0)
                        resolve()
                      else reject(new Error(`Git command failed with code ${code}`))
                    })
                    child.on('error', reject)
                  })
                }

                // Reset to clean main state before generating file updates
                await runGitCommand('git', ['checkout', 'main'])
                await runGitCommand('git', ['reset', '--hard', 'HEAD'])
                await runGitCommand('git', ['clean', '-fd'])

                console.log(`🧹 Reset to clean main state before updating existing PR ${existingPR.number}`)
              }
              catch (error) {
                console.warn(`⚠️ Failed to reset to clean state, continuing anyway:`, error)
              }

              // Regenerate file updates with latest dependency versions
              const packageJsonUpdates = await this.generateAllFileUpdates(group.updates)

              // Check if we have any file changes to commit
              if (packageJsonUpdates.length === 0) {
                this.logger.warn(`ℹ️ No file changes generated for existing PR ${existingPR.number}, updating metadata only`)
              }
              else {
                this.logger.info(`📝 Regenerated ${packageJsonUpdates.length} file changes for existing PR ${existingPR.number}`)

                // Commit the updated changes to the existing branch
                // This will overwrite the old file content with the new versions
                await gitProvider.commitChanges(existingBranchName, `${group.title} (updated)`, packageJsonUpdates)

                this.logger.success(`✅ Updated files in branch ${existingBranchName} with latest dependency versions`)
              }

              // Generate dynamic labels for the update
              const dynamicLabels = prGenerator.generateLabels(group)

              // Update existing PR with new content
              await gitProvider.updatePullRequest(existingPR.number, {
                title: prTitle,
                body: prBody,
                labels: dynamicLabels,
                reviewers: this.config.pullRequest?.reviewers,
                assignees: this.config.pullRequest?.assignees,
              })

              this.logger.success(`✅ Updated existing PR #${existingPR.number}: ${prTitle}`)
              this.logger.info(`🔗 ${existingPR.url}`)
              continue
            }
          }

          // Generate unique branch name
          const timestamp = Date.now()
          const branchName = `buddy-bot/update-${group.name.toLowerCase().replace(/\s+/g, '-')}-${timestamp}`

          // Create branch
          await gitProvider.createBranch(branchName, this.config.repository.baseBranch || 'main')

          // Ensure we're on a clean main branch before generating updates
          // This prevents reading modified files from previous PR generations
          try {
            const { spawn } = await import('node:child_process')
            const runGitCommand = (command: string, args: string[]): Promise<void> => {
              return new Promise((resolve, reject) => {
                const child = spawn(command, args, { stdio: 'pipe' })
                child.on('close', (code) => {
                  if (code === 0)
                    resolve()
                  else reject(new Error(`Git command failed with code ${code}`))
                })
                child.on('error', reject)
              })
            }

            // Reset to clean main state before generating file updates
            await runGitCommand('git', ['checkout', 'main'])
            await runGitCommand('git', ['reset', '--hard', 'HEAD'])
            await runGitCommand('git', ['clean', '-fd'])

            console.log(`🧹 Reset to clean main state before generating updates for ${group.name}`)
          }
          catch (error) {
            console.warn(`⚠️ Failed to reset to clean state, continuing anyway:`, error)
          }

          // Update package.json with new versions
          const packageJsonUpdates = await this.generateAllFileUpdates(group.updates)

          // Check if we have any file changes to commit
          if (packageJsonUpdates.length === 0) {
            this.logger.warn(`ℹ️ No file changes generated for group ${group.name}, skipping PR creation`)
            continue
          }

          // Validate that file changes actually contain updates
          let hasActualChanges = false
          for (const fileUpdate of packageJsonUpdates) {
            try {
              const fs = await import('node:fs')
              if (fs.existsSync(fileUpdate.path)) {
                const currentContent = fs.readFileSync(fileUpdate.path, 'utf-8')
                if (currentContent !== fileUpdate.content) {
                  hasActualChanges = true
                  break
                }
              }
              else {
                // New file, counts as a change
                hasActualChanges = true
                break
              }
            }
            catch {
              // If we can't read the file, assume it's a change
              hasActualChanges = true
              break
            }
          }

          if (!hasActualChanges) {
            this.logger.warn(`ℹ️ No actual content changes for group ${group.name}, skipping PR creation`)
            continue
          }

          this.logger.info(`📝 Generated ${packageJsonUpdates.length} file changes for ${group.name}`)

          // Commit changes
          await gitProvider.commitChanges(branchName, group.title, packageJsonUpdates)

          // Generate dynamic labels based on update types and package types
          const dynamicLabels = prGenerator.generateLabels(group)

          // Create pull request
          const pr = await gitProvider.createPullRequest({
            title: prTitle,
            body: prBody,
            head: branchName,
            base: this.config.repository.baseBranch || 'main',
            draft: false,
            reviewers: this.config.pullRequest?.reviewers,
            assignees: this.config.pullRequest?.assignees,
            labels: dynamicLabels,
          })

          this.logger.success(`✅ Created PR #${pr.number}: ${pr.title}`)
          this.logger.info(`🔗 ${pr.url}`)
        }
        catch (error) {
          this.logger.error(`❌ Failed to create PR for group ${group.name}:`, error)
        }
      }

      this.logger.success(`✅ Completed PR creation for ${scanResult.groups.length} group(s)`)
    }
    catch (error) {
      this.logger.error('Failed to create pull requests:', error)
      throw error
    }
  }

  /**
   * Check dependency files for updates using ts-pkgx
   */
  private async checkDependencyFilesForUpdates(packageFiles: PackageFile[]): Promise<PackageUpdate[]> {
    const { isDependencyFile } = await import('./utils/dependency-file-parser')
    const { resolveDependencyFile } = await import('ts-pkgx')

    const updates: PackageUpdate[] = []

    // Filter to only dependency files (not package.json or lock files)
    const dependencyFiles = packageFiles.filter(file => isDependencyFile(file.path))

    for (const file of dependencyFiles) {
      try {
        this.logger.info(`Checking dependency file: ${file.path}`)

        // Use ts-pkgx to resolve latest versions
        const resolved = await resolveDependencyFile(file.path)

        for (const dep of resolved.allDependencies || []) {
          // Check if current version should be respected (like "*", "latest", etc.)
          const shouldRespectVersion = (version: string): boolean => {
            const respectLatest = this.config.packages?.respectLatest ?? true
            if (!respectLatest)
              return false

            const dynamicIndicators = ['latest', '*', 'main', 'master', 'develop', 'dev']
            const cleanVersion = version.toLowerCase().trim()
            return dynamicIndicators.includes(cleanVersion)
          }

          if (shouldRespectVersion(dep.constraint)) {
            this.logger.debug(`Skipping ${dep.name} - version "${dep.constraint}" should be respected`)
            continue
          }

          // Compare constraint version with resolved version
          if (dep.constraint !== dep.version && dep.version) {
            // Extract version prefix (^, ~, >=, etc.) from constraint
            // const prefixMatch = dep.constraint.match(/^(\D*)/)
            // const originalPrefix = prefixMatch ? prefixMatch[1] : ''
            const constraintVersion = dep.constraint.replace(/^[\^~>=<]+/, '')

            // Ensure we only propose upgrades, never downgrades
            if (!this.isNewerVersion(constraintVersion, dep.version)) {
              this.logger.debug(`Skipping ${dep.name} - latest (${dep.version}) is not newer than constraint (${constraintVersion})`)
              continue
            }

            // Determine update type
            const updateType = this.getUpdateType(constraintVersion, dep.version)

            // Don't add prefix here - let the file updater handle prefix preservation
            // This prevents double prefixes when the constraint already has one
            const newVersion = dep.version

            updates.push({
              name: dep.name,
              currentVersion: dep.constraint,
              newVersion,
              updateType,
              dependencyType: 'dependencies',
              file: file.path,
              metadata: undefined, // Could enhance with package metadata later
              releaseNotesUrl: undefined,
              changelogUrl: undefined,
              homepage: undefined,
            })
          }
        }
      }
      catch (error) {
        this.logger.error(`Failed to check dependency file ${file.path}:`, error)
      }
    }

    return updates
  }

  /**
   * Check GitHub Actions for updates
   */
  private async checkGitHubActionsForUpdates(packageFiles: PackageFile[]): Promise<PackageUpdate[]> {
    const { isGitHubActionsFile } = await import('./utils/github-actions-parser')
    const { fetchLatestActionVersion } = await import('./utils/github-actions-parser')

    const updates: PackageUpdate[] = []

    // Filter to only GitHub Actions files
    const githubActionsFiles = packageFiles.filter(file => isGitHubActionsFile(file.path))

    this.logger.info(`🔍 Found ${githubActionsFiles.length} GitHub Actions workflow files`)

    for (const file of githubActionsFiles) {
      try {
        this.logger.info(`Checking GitHub Actions file: ${file.path}`)

        // Get all GitHub Actions dependencies from this file
        const actionDeps = file.dependencies.filter(dep => dep.type === 'github-actions')
        this.logger.info(`Found ${actionDeps.length} GitHub Actions in ${file.path}`)

        for (const dep of actionDeps) {
          try {
            this.logger.info(`Checking action: ${dep.name}@${dep.currentVersion}`)

            // Fetch latest version for this action
            const latestVersion = await fetchLatestActionVersion(dep.name)

            if (latestVersion) {
              this.logger.info(`Latest version for ${dep.name}: ${latestVersion}`)

              if (latestVersion !== dep.currentVersion) {
                // Determine update type
                const updateType = this.getUpdateType(dep.currentVersion, latestVersion)

                this.logger.info(`Update available: ${dep.name} ${dep.currentVersion} → ${latestVersion} (${updateType})`)

                updates.push({
                  name: dep.name,
                  currentVersion: dep.currentVersion,
                  newVersion: latestVersion,
                  updateType,
                  dependencyType: 'github-actions',
                  file: file.path,
                  metadata: undefined,
                  releaseNotesUrl: `https://github.com/${dep.name}/releases`,
                  changelogUrl: undefined,
                  homepage: `https://github.com/${dep.name}`,
                })
              }
              else {
                this.logger.info(`No update needed for ${dep.name}: already at ${latestVersion}`)
              }
            }
            else {
              this.logger.warn(`Could not fetch latest version for ${dep.name}`)
            }
          }
          catch (error) {
            this.logger.warn(`Failed to check version for action ${dep.name}:`, error)
          }
        }
      }
      catch (error) {
        this.logger.error(`Failed to check GitHub Actions file ${file.path}:`, error)
      }
    }

    this.logger.info(`Generated ${updates.length} GitHub Actions updates`)

    // Additional safety: deduplicate updates by name, version, and file
    // This ensures no duplicate PackageUpdate objects make it to PR generation
    const deduplicatedUpdates = updates.reduce((acc, update) => {
      const existing = acc.find(u =>
        u.name === update.name
        && u.currentVersion === update.currentVersion
        && u.newVersion === update.newVersion
        && u.file === update.file,
      )
      if (!existing) {
        acc.push(update)
      }
      return acc
    }, [] as PackageUpdate[])

    this.logger.info(`After deduplication: ${deduplicatedUpdates.length} unique GitHub Actions updates`)

    return deduplicatedUpdates
  }

  /**
   * Determine update type based on version comparison
   */
  private getUpdateType(current: string, latest: string): 'major' | 'minor' | 'patch' {
    try {
      // Clean version strings, including v, @ prefix for version ranges
      const cleanCurrent = current.replace(/^[v^~>=<@]+/, '')
      const cleanLatest = latest.replace(/^[v^~>=<@]+/, '')

      if (Bun.semver.order(cleanLatest, cleanCurrent) <= 0)
        return 'patch'

      if (Bun.semver.satisfies(cleanLatest, `~${cleanCurrent}`))
        return 'patch'

      if (Bun.semver.satisfies(cleanLatest, `^${cleanCurrent}`))
        return 'minor'

      return 'major'
    }
    catch {
      return 'patch'
    }
  }

  /**
   * Check if latest version is strictly newer than current
   */
  private isNewerVersion(current: string, latest: string): boolean {
    try {
      return Bun.semver.order(latest.replace(/^[v^~>=<@]+/, ''), current.replace(/^[v^~>=<@]+/, '')) > 0
    }
    catch {
      return false
    }
  }

  /**
   * Generate file changes for updates (package.json, dependency files, GitHub Actions, etc.)
   */
  async generateAllFileUpdates(updates: PackageUpdate[]): Promise<Array<{ path: string, content: string, type: 'update' }>> {
    const fileUpdates: Array<{ path: string, content: string, type: 'update' }> = []

    // Handle package.json updates - only for actual package.json files, not dependency or GitHub Actions files
    const packageJsonUpdates = updates.filter(update =>
      update.file.endsWith('package.json')
      && !update.file.includes('.yaml')
      && !update.file.includes('.yml')
      && !update.file.includes('.github/workflows/'),
    )

    // Group package.json updates by file
    const updatesByPackageFile = new Map<string, PackageUpdate[]>()
    for (const update of packageJsonUpdates) {
      if (!updatesByPackageFile.has(update.file)) {
        updatesByPackageFile.set(update.file, [])
      }
      updatesByPackageFile.get(update.file)!.push(update)
    }

    // Process each package.json file
    for (const [packageJsonPath, packageUpdates] of updatesByPackageFile) {
      try {
        // Read current package.json content as string to preserve formatting
        let packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8')

        // Parse to understand structure
        const packageJson = JSON.parse(packageJsonContent)

        // Apply updates using string replacement to preserve formatting
        for (const update of packageUpdates) {
          let packageFound = false

          // Clean package name (remove dependency type info like "(dev)")
          const cleanPackageName = update.name.replace(/\s*\(dev\)$/, '').replace(/\s*\(peer\)$/, '').replace(/\s*\(optional\)$/, '')

          // Try to find and update the package in each dependency section
          const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

          for (const section of dependencySections) {
            if (packageJson[section] && packageJson[section][cleanPackageName]) {
              const currentVersionInFile = packageJson[section][cleanPackageName]

              // Extract the original version prefix (^, ~, >=, etc.) or lack thereof
              const versionPrefixMatch = currentVersionInFile.match(/^(\D*)/)
              const originalPrefix = versionPrefixMatch ? versionPrefixMatch[1] : ''

              // Create regex to find the exact line with this package and version
              // This handles various formatting styles like: "package": "version", "package":"version", etc.
              const packageRegex = new RegExp(
                `("${cleanPackageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*")([^"]+)(")`,
                'g',
              )

              // Preserve the original prefix when updating to new version
              const newVersion = `${originalPrefix}${update.newVersion}`
              packageJsonContent = packageJsonContent.replace(packageRegex, `$1${newVersion}$3`)
              packageFound = true
              break
            }
          }

          if (!packageFound) {
            console.warn(`Package ${cleanPackageName} not found in ${packageJsonPath}`)
          }
        }

        fileUpdates.push({
          path: packageJsonPath,
          content: packageJsonContent,
          type: 'update' as const,
        })
      }
      catch (error) {
        console.warn(`Failed to update ${packageJsonPath}:`, error)
      }
    }

    // Handle dependency file updates (deps.yaml, dependencies.yaml, etc.)
    // Only process if we have dependency file updates to avoid unnecessary processing
    const dependencyFileUpdates = updates.filter(update =>
      (update.file.includes('.yaml') || update.file.includes('.yml'))
      && !update.file.includes('.github/workflows/'),
    )
    if (dependencyFileUpdates.length > 0) {
      try {
        const { generateDependencyFileUpdates } = await import('./utils/dependency-file-parser')
        // Pass only the dependency file updates to avoid cross-contamination
        const depFileUpdates = await generateDependencyFileUpdates(dependencyFileUpdates)
        fileUpdates.push(...depFileUpdates)
      }
      catch (error) {
        this.logger.error('Failed to generate dependency file updates:', error)
        // Continue with other updates even if dependency file updates fail
      }
    }

    // Handle Composer updates
    // Only process if we have composer updates to avoid unnecessary processing
    const composerUpdates = updates.filter(update =>
      update.file.endsWith('composer.json') || update.file.endsWith('composer.lock'),
    )
    if (composerUpdates.length > 0) {
      try {
        const { generateComposerUpdates } = await import('./utils/composer-parser')
        // Pass only the composer updates for this specific group to prevent cross-contamination
        const compUpdates = await generateComposerUpdates(composerUpdates)
        fileUpdates.push(...compUpdates)
      }
      catch (error) {
        this.logger.error('Failed to generate Composer updates:', error)
        // Continue with other updates even if Composer updates fail
      }
    }

    // Handle GitHub Actions updates
    // Only process if we have GitHub Actions updates to avoid unnecessary processing
    const githubActionsUpdates = updates.filter(update =>
      update.file.includes('.github/workflows/'),
    )
    if (githubActionsUpdates.length > 0) {
      try {
        const { generateGitHubActionsUpdates } = await import('./utils/github-actions-parser')
        // Pass only the GitHub Actions updates for this specific group
        const ghActionsUpdates = await generateGitHubActionsUpdates(githubActionsUpdates)
        fileUpdates.push(...ghActionsUpdates)
      }
      catch (error) {
        this.logger.error('Failed to generate GitHub Actions updates:', error)
        // Continue with other updates even if GitHub Actions updates fail
      }
    }

    return fileUpdates
  }

  /**
   * Run the full update process
   */
  async run(): Promise<UpdateScanResult> {
    const scanResult = await this.scanForUpdates()

    if (scanResult.updates.length === 0) {
      this.logger.info('No updates available!')
      return scanResult
    }

    // Create PRs if configured
    if (this.config.pullRequest) {
      await this.createPullRequests(scanResult)
    }

    return scanResult
  }

  /**
   * Check specific packages for updates
   */
  async checkPackages(packageNames: string[]): Promise<PackageUpdate[]> {
    this.logger.info(`Checking specific packages: ${packageNames.join(', ')}`)
    return this.registryClient.getUpdatesForPackages(packageNames)
  }

  /**
   * Check packages using glob pattern
   */
  async checkPackagesWithPattern(pattern: string): Promise<PackageUpdate[]> {
    this.logger.info(`Checking packages with pattern: ${pattern}`)
    return this.registryClient.getUpdatesWithPattern(pattern)
  }

  /**
   * Filter updates by strategy
   */
  private filterUpdatesByStrategy(
    updates: PackageUpdate[],
    strategy: 'major' | 'minor' | 'patch' | 'all',
  ): PackageUpdate[] {
    if (strategy === 'all')
      return updates

    return updates.filter((update) => {
      switch (strategy) {
        case 'major':
          return update.updateType === 'major'
        case 'minor':
          return update.updateType === 'major' || update.updateType === 'minor'
        case 'patch':
          return true // Include all types for patch strategy
        default:
          return true
      }
    })
  }

  /**
   * Group updates based on configuration
   */
  private groupUpdatesByConfig(updates: PackageUpdate[]): UpdateGroup[] {
    const groups: UpdateGroup[] = []
    const ungroupedUpdates = [...updates]

    // Process configured groups
    if (this.config.packages?.groups) {
      for (const groupConfig of this.config.packages.groups) {
        const groupUpdates: PackageUpdate[] = []

        // Find updates matching group patterns
        for (const pattern of groupConfig.patterns) {
          const regex = new RegExp(pattern.replace('*', '.*'))
          const matchingUpdates = ungroupedUpdates.filter(update => regex.test(update.name))
          groupUpdates.push(...matchingUpdates)

          // Remove from ungrouped
          matchingUpdates.forEach((update) => {
            const index = ungroupedUpdates.indexOf(update)
            if (index > -1)
              ungroupedUpdates.splice(index, 1)
          })
        }

        if (groupUpdates.length > 0) {
          // Apply group-specific strategy if defined
          let filteredUpdates = groupUpdates
          if (groupConfig.strategy) {
            filteredUpdates = this.filterUpdatesByStrategy(groupUpdates, groupConfig.strategy)
          }

          groups.push({
            name: groupConfig.name,
            updates: filteredUpdates,
            updateType: this.getHighestUpdateType(filteredUpdates),
            title: `chore(deps): update ${groupConfig.name}`,
            body: `Update ${filteredUpdates.length} packages in ${groupConfig.name} group`,
          })
        }
      }
    }

    // Add remaining ungrouped updates as default groups
    if (ungroupedUpdates.length > 0) {
      const defaultGroups = groupUpdates(ungroupedUpdates)
      groups.push(...defaultGroups)
    }

    return groups
  }

  /**
   * Get the highest update type from a list of updates
   */
  private getHighestUpdateType(updates: PackageUpdate[]): 'major' | 'minor' | 'patch' {
    if (updates.some(u => u.updateType === 'major'))
      return 'major'
    if (updates.some(u => u.updateType === 'minor'))
      return 'minor'
    return 'patch'
  }

  /**
   * Check if two PR titles are similar (for dependency updates)
   */
  private isSimilarPRTitle(existingTitle: string, newTitle: string): boolean {
    // Exact match is always similar
    if (existingTitle.toLowerCase() === newTitle.toLowerCase()) {
      return true
    }

    // For major updates, be very specific - only match if it's the exact same package and version
    if (newTitle.toLowerCase().includes('update dependency ')) {
      // Extract package name from titles like "chore(deps): update dependency package-name to v1.0"
      const newPackageMatch = newTitle.match(/update dependency (\S+)/i)
      const existingPackageMatch = existingTitle.match(/update dependency (\S+)/i)

      if (newPackageMatch && existingPackageMatch) {
        // Only similar if same package name
        return newPackageMatch[1] === existingPackageMatch[1]
      }
    }

    // Don't match different update types (major vs non-major, individual vs grouped)
    const existingLower = existingTitle.toLowerCase()
    const newLower = newTitle.toLowerCase()

    // If one is for "all non-major" and other is for specific dependency, they're different
    if ((existingLower.includes('all non-major') && newLower.includes('dependency '))
      || (newLower.includes('all non-major') && existingLower.includes('dependency '))) {
      return false
    }

    // Different specific dependencies are different PRs
    if (existingLower.includes('dependency ') && newLower.includes('dependency ')) {
      return false // Each dependency gets its own PR
    }

    // Otherwise, not similar
    return false
  }

  /**
   * Check if existing PR body contains the same package updates
   */
  private checkIfUpdatesMatch(existingPRBody: string, newUpdates: PackageUpdate[]): boolean {
    if (!existingPRBody)
      return false

    // Extract package names and versions from the existing PR body
    const packageRegex = /([\w@\-./]+):\s*(\d+\.\d+\.\d\S*)\s*→\s*(\d+\.\d+\.\d\S*)/g
    const existingUpdates = new Map<string, { from: string, to: string }>()

    let match
    // eslint-disable-next-line no-cond-assign
    while ((match = packageRegex.exec(existingPRBody)) !== null) {
      const [, packageName, fromVersion, toVersion] = match
      existingUpdates.set(packageName, { from: fromVersion, to: toVersion })
    }

    // Check if all new updates are already covered
    for (const update of newUpdates) {
      const existing = existingUpdates.get(update.name)
      if (!existing || existing.to !== update.newVersion) {
        return false // Different or missing update
      }
    }

    // Check if existing PR has the same number of updates (avoid subset matches)
    return existingUpdates.size === newUpdates.length
  }

  /**
   * Generate dynamic labels for PR based on update types and configuration
   */
  private generatePRLabels(group: UpdateGroup): string[] {
    const labels = new Set<string>()

    // Always add dependencies label
    labels.add('dependencies')

    // Add update type specific labels
    const updateTypes = group.updates.map(u => u.updateType)
    const hasUpdates = {
      major: updateTypes.includes('major'),
      minor: updateTypes.includes('minor'),
      patch: updateTypes.includes('patch'),
    }

    // Add specific update type labels
    if (hasUpdates.major) {
      labels.add('major')
    }
    if (hasUpdates.minor) {
      labels.add('minor')
    }
    if (hasUpdates.patch) {
      labels.add('patch')
    }

    // Add additional contextual labels
    if (group.updates.length > 5) {
      labels.add('dependencies') // Use standard dependencies label instead of bulk-update
    }

    // Add security label if any package might be security related
    const securityPackages = ['helmet', 'express-rate-limit', 'cors', 'bcrypt', 'jsonwebtoken']
    const hasSecurityPackage = group.updates.some(update =>
      securityPackages.some(pkg => update.name.includes(pkg)),
    )
    if (hasSecurityPackage) {
      labels.add('security')
    }

    // Add configured labels from config if they exist (but avoid duplicates)
    if (this.config.pullRequest?.labels) {
      this.config.pullRequest.labels.forEach((label) => {
        // Only add if it's not 'dependencies' since we always add that
        if (label !== 'dependencies') {
          labels.add(label)
        }
      })
    }

    // Convert to array and return
    return Array.from(labels)
  }

  /**
   * Check if a PR should be auto-closed due to respectLatest config changes
   * This handles cases where old PRs were created with respectLatest: false
   * but now the config is respectLatest: true, making those updates invalid
   */
  private shouldAutoClosePR(existingPR: PullRequest, newUpdates: PackageUpdate[]): boolean {
    const respectLatest = this.config.packages?.respectLatest ?? true

    // Only auto-close if respectLatest is true (the new default behavior)
    if (!respectLatest) {
      return false
    }

    // Check if the existing PR contains updates that would now be filtered out
    // Look for dynamic version indicators in the PR body
    const dynamicIndicators = ['latest', '*', 'main', 'master', 'develop', 'dev']
    const prBody = existingPR.body.toLowerCase()

    // Check if the PR body contains any dynamic version indicators
    const hasDynamicVersions = dynamicIndicators.some(indicator =>
      prBody.includes(indicator.toLowerCase()),
    )

    if (!hasDynamicVersions) {
      return false
    }

    // Check if the new updates don't include the same packages that were in the old PR
    // This indicates the packages were filtered out due to respectLatest
    const oldPRPackages = this.extractPackagesFromPRBody(existingPR.body)
    const newUpdatePackages = newUpdates.map(update => update.name)

    // If old PR had packages that are not in new updates, and those packages had dynamic versions
    const missingPackages = oldPRPackages.filter(pkg => !newUpdatePackages.includes(pkg))

    if (missingPackages.length === 0) {
      return false
    }

    // Check if the missing packages had dynamic versions in the old PR
    const missingPackagesWithDynamicVersions = missingPackages.filter((pkg) => {
      // Look for the package in the PR body table format: | [package](url) | version → newVersion |
      const packagePattern = new RegExp(`\\|\\s*\\[${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\([^)]+\\)\\s*\\|\\s*([^|]+)\\s*\\|`, 'i')
      const match = existingPR.body.match(packagePattern)
      if (!match) {
        // Fallback: look for the package name anywhere in the body with a version pattern
        const fallbackPattern = new RegExp(`${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\w]*[:=]\\s*["']?([^"'\n]+)["']?`, 'i')
        const fallbackMatch = existingPR.body.match(fallbackPattern)
        if (!fallbackMatch)
          return false

        const version = fallbackMatch[1].toLowerCase().trim()
        return dynamicIndicators.includes(version)
      }

      // Extract the version change part (e.g., "* → 3.13.5")
      const versionChange = match[1].trim()
      const currentVersionMatch = versionChange.match(/^([^→]+)→/)
      if (!currentVersionMatch)
        return false

      const currentVersion = currentVersionMatch[1].trim().toLowerCase()
      return dynamicIndicators.includes(currentVersion)
    })

    return missingPackagesWithDynamicVersions.length > 0
  }

  /**
   * Extract package names from PR body
   */
  private extractPackagesFromPRBody(prBody: string): string[] {
    const packages: string[] = []

    // Look for package names in the PR body table
    const tableMatch = prBody.match(/\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|/g)
    if (tableMatch) {
      for (const row of tableMatch) {
        // Extract package name from table row - use a more specific pattern to avoid backtracking
        const packageMatch = row.match(/\[([^\]]+)\]\([^)]*\)/)
        if (packageMatch) {
          packages.push(packageMatch[1])
        }
      }
    }

    // Also look for package names in the release notes section
    const releaseNotesMatch = prBody.match(/<summary>([^<]+)<\/summary>/g)
    if (releaseNotesMatch) {
      for (const match of releaseNotesMatch) {
        const packageName = match.replace(/<summary>/, '').replace(/<\/summary>/, '').trim()
        if (packageName && !packages.includes(packageName)) {
          packages.push(packageName)
        }
      }
    }

    return packages
  }

  /**
   * Get configuration summary
   */
  getConfig(): BuddyBotConfig {
    return this.config
  }

  /**
   * Get project path
   */
  getProjectPath(): string {
    return this.projectPath
  }

  /**
   * Create or update dependency dashboard
   */
  async createOrUpdateDashboard(): Promise<Issue> {
    try {
      this.logger.info('Creating or updating dependency dashboard...')

      // Validate configuration
      if (!this.config.repository) {
        throw new Error('Repository configuration is required for dashboard')
      }

      if (this.config.repository.provider !== 'github') {
        throw new Error('Dashboard is currently only supported for GitHub repositories')
      }

      // Initialize git provider
      const token = this.config.repository.token || process.env.BUDDY_BOT_TOKEN || process.env.GITHUB_TOKEN || ''
      const hasWorkflowPermissions = !!process.env.BUDDY_BOT_TOKEN
      const gitProvider = new GitHubProvider(
        token,
        this.config.repository.owner,
        this.config.repository.name,
        hasWorkflowPermissions,
      )

      // Collect dashboard data
      const dashboardData = await this.collectDashboardData(gitProvider)

      // Generate dashboard content
      const dashboardConfig = this.config.dashboard || {}
      const { title, body } = this.dashboardGenerator.generateDashboard(dashboardData, {
        showOpenPRs: dashboardConfig.showOpenPRs ?? true,
        showDetectedDependencies: dashboardConfig.showDetectedDependencies ?? true,
        showDeprecatedDependencies: dashboardConfig.showDeprecatedDependencies ?? true,
        bodyTemplate: dashboardConfig.bodyTemplate,
      })

      // Check if dashboard issue already exists
      const existingIssue = await this.findExistingDashboard(gitProvider, dashboardConfig.issueNumber)

      let issue: Issue

      if (existingIssue) {
        this.logger.info(`Updating existing dashboard issue #${existingIssue.number}`)

        // Update existing dashboard
        issue = await gitProvider.updateIssue(existingIssue.number, {
          title: dashboardConfig.title || title,
          body,
          labels: dashboardConfig.labels || ['dependencies', 'dashboard'],
          assignees: dashboardConfig.assignees,
        })

        this.logger.success(`✅ Successfully updated dashboard issue #${issue.number}`)
      }
      else {
        this.logger.info('Creating new dashboard issue')

        // Double-check for race condition: search again right before creating
        // This helps prevent duplicates if multiple workflow runs are happening simultaneously
        this.logger.info('Performing final check for existing dashboards before creation...')
        const raceCheckIssue = await this.findExistingDashboard(gitProvider, dashboardConfig.issueNumber)

        if (raceCheckIssue) {
          this.logger.info(`Race condition detected! Found existing dashboard #${raceCheckIssue.number} during final check`)
          // Update the found issue instead of creating a new one
          issue = await gitProvider.updateIssue(raceCheckIssue.number, {
            title: dashboardConfig.title || title,
            body,
            labels: dashboardConfig.labels || ['dependencies', 'dashboard'],
            assignees: dashboardConfig.assignees,
          })
          this.logger.success(`✅ Updated existing dashboard issue #${issue.number} (race condition avoided)`)
        }
        else {
          // Safe to create new dashboard
          issue = await gitProvider.createIssue({
            title: dashboardConfig.title || title,
            body,
            labels: dashboardConfig.labels || ['dependencies', 'dashboard'],
            assignees: dashboardConfig.assignees,
          })
          this.logger.success(`✅ Successfully created new dashboard issue #${issue.number}`)
        }
      }

      this.logger.success(`✅ Dashboard updated: ${issue.url}`)
      return issue
    }
    catch (error) {
      this.logger.error('Failed to create or update dashboard:', error)
      throw error
    }
  }

  /**
   * Collect all data needed for the dashboard
   */
  private async collectDashboardData(gitProvider: GitHubProvider): Promise<DashboardData> {
    const [packageFiles, openPRs] = await Promise.all([
      this.scanner.scanProject(),
      gitProvider.getPullRequests('open'),
    ])

    // Filter PRs to include all dependency updates (from any source: buddy-bot, renovate, etc.)
    const dependencyPRs = openPRs.filter(pr =>
      // Include any PR that appears to be a dependency update
      pr.labels.includes('dependencies')
      || pr.labels.includes('dependency')
      || pr.labels.includes('deps')
      || pr.title.toLowerCase().includes('update')
      || pr.title.toLowerCase().includes('chore(deps)')
      || pr.title.toLowerCase().includes('bump')
      || pr.title.toLowerCase().includes('upgrade')
      || pr.title.toLowerCase().includes('renovate')
      || pr.head.includes('renovate/')
      || pr.head.includes('dependabot/')
      || pr.head.includes('buddy-bot/')
      || pr.head.includes('update-')
      || pr.head.includes('bump-'),
    )

    // Categorize package files
    const packageJson = packageFiles.filter(file => file.type === 'package.json')
    const githubActions = packageFiles.filter(file =>
      file.path.includes('.github/workflows/')
      && (file.path.endsWith('.yml') || file.path.endsWith('.yaml')),
    )
    const dependencyFiles = packageFiles.filter(file =>
      !file.path.includes('.github/workflows/')
      && file.type !== 'package.json',
    )

    // Check for deprecated dependencies
    const deprecatedChecker = new DeprecatedDependenciesChecker()
    const deprecatedDependencies = await deprecatedChecker.checkDeprecatedDependencies(packageFiles)

    return {
      openPRs: dependencyPRs,
      detectedDependencies: {
        packageJson,
        dependencyFiles,
        githubActions,
      },
      deprecatedDependencies,
      repository: {
        owner: this.config.repository!.owner,
        name: this.config.repository!.name,
        provider: this.config.repository!.provider,
      },
      lastUpdated: new Date(),
    }
  }

  /**
   * Find existing dashboard issue
   */
  private async findExistingDashboard(gitProvider: GitHubProvider, issueNumber?: number): Promise<Issue | null> {
    try {
      this.logger.info('Searching for existing dashboard issue...')

      // If issue number is provided, try to get that specific issue
      if (issueNumber) {
        this.logger.info(`Looking for specific dashboard issue #${issueNumber}`)
        const issues = await gitProvider.getIssues('open')
        const specificIssue = issues.find(issue => issue.number === issueNumber)
        if (specificIssue) {
          this.logger.info(`Found specified dashboard issue #${specificIssue.number}: ${specificIssue.title}`)
          return specificIssue
        }
        else {
          this.logger.warn(`Specified dashboard issue #${issueNumber} not found`)
          return null
        }
      }

      // Get all open issues
      const issues = await gitProvider.getIssues('open')
      this.logger.info(`Found ${issues.length} open issues to search through`)

      // Search for existing dashboard with multiple criteria for better matching
      for (const issue of issues) {
        const hasRequiredLabels = issue.labels.includes('dashboard') && issue.labels.includes('dependencies')
        const titleMatches = issue.title.toLowerCase().includes('dependency dashboard')
        const bodyHasMarker = issue.body.includes('This issue lists Buddy Bot updates and detected dependencies')

        // Be more strict: require both proper labels AND (title match OR body marker)
        if (hasRequiredLabels && (titleMatches || bodyHasMarker)) {
          this.logger.info(`Found existing dashboard issue #${issue.number}: ${issue.title}`)
          this.logger.info(`  - Labels: ${issue.labels.join(', ')}`)
          this.logger.info(`  - Title matches: ${titleMatches}`)
          this.logger.info(`  - Body has marker: ${bodyHasMarker}`)
          return issue
        }
      }

      // If no exact match found, log what we found for debugging
      const dashboardLabeled = issues.filter(issue => issue.labels.includes('dashboard'))
      const dependenciesLabeled = issues.filter(issue => issue.labels.includes('dependencies'))
      const titleMatches = issues.filter(issue => issue.title.toLowerCase().includes('dependency dashboard'))

      this.logger.info(`Dashboard search results:`)
      this.logger.info(`  - Issues with 'dashboard' label: ${dashboardLabeled.length}`)
      this.logger.info(`  - Issues with 'dependencies' label: ${dependenciesLabeled.length}`)
      this.logger.info(`  - Issues with 'dependency dashboard' in title: ${titleMatches.length}`)

      if (dashboardLabeled.length > 0) {
        this.logger.info(`Issues with 'dashboard' label:`)
        for (const issue of dashboardLabeled) {
          this.logger.info(`  - #${issue.number}: ${issue.title} (labels: ${issue.labels.join(', ')})`)
        }
      }

      this.logger.info('No existing dashboard issue found')
      return null
    }
    catch (error) {
      this.logger.warn(`Failed to search for existing dashboard: ${error}`)
      return null
    }
  }
}
