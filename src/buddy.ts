import type {
  BuddyBotConfig,
  PackageUpdate,
  UpdateGroup,
  UpdateScanResult,
} from './types'
import fs from 'node:fs'
import process from 'node:process'
import { GitHubProvider } from './git/github-provider'
import { PullRequestGenerator } from './pr/pr-generator'
import { RegistryClient } from './registry/registry-client'
import { PackageScanner } from './scanner/package-scanner'
import { groupUpdates, sortUpdatesByPriority } from './utils/helpers'
import { Logger } from './utils/logger'

export class Buddy {
  private readonly logger: Logger
  private readonly scanner: PackageScanner
  private readonly registryClient: RegistryClient

  constructor(
    private readonly config: BuddyBotConfig,
    private readonly projectPath: string = process.cwd(),
  ) {
    this.logger = new Logger(false) // Will be configurable
    this.scanner = new PackageScanner(this.projectPath, this.logger)
    this.registryClient = new RegistryClient(this.projectPath, this.logger)
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

      // Get outdated packages using bun outdated
      let updates: PackageUpdate[] = []

      if (this.config.packages?.ignore && this.config.packages.ignore.length > 0) {
        // Get all updates first, then filter
        const allUpdates = await this.registryClient.getOutdatedPackages()
        updates = allUpdates.filter(update => !this.config.packages!.ignore!.includes(update.name))
      }
      else {
        updates = await this.registryClient.getOutdatedPackages()
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

      const duration = Date.now() - startTime

      const result: UpdateScanResult = {
        totalPackages,
        updates,
        groups,
        scannedAt: new Date(),
        duration,
      }

      this.logger.success(`Scan completed in ${duration}ms. Found ${updates.length} updates.`)
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

      // Get GitHub token from environment
      const token = process.env.GITHUB_TOKEN
      if (!token) {
        this.logger.error('❌ GITHUB_TOKEN environment variable required for PR creation')
        return
      }

      // Initialize GitHub provider
      const gitProvider = new GitHubProvider(
        token,
        this.config.repository.owner,
        this.config.repository.name,
      )

      // Initialize PR generator
      const prGenerator = new PullRequestGenerator()

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
            pr.title === prTitle ||
            pr.head.startsWith(branchPattern) ||
            this.isSimilarPRTitle(pr.title, prTitle)
          )

          if (existingPR) {
            this.logger.info(`🔄 Found existing PR #${existingPR.number}: ${existingPR.title}`)

            // Check if the updates are the same by comparing package lists
            const existingUpdatesMatch = this.checkIfUpdatesMatch(existingPR.body, group.updates)

            if (existingUpdatesMatch) {
              this.logger.info(`✅ Existing PR has the same updates, skipping creation`)
              continue
            } else {
              this.logger.info(`🔄 Updates differ, will update existing PR with new content`)

              // Update existing PR with new content
              await gitProvider.updatePullRequest(existingPR.number, {
                title: prTitle,
                body: prBody,
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

          // Update package.json with new versions
          const packageJsonUpdates = await this.generatePackageJsonUpdates(group.updates)

          // Commit changes
          await gitProvider.commitChanges(branchName, group.title, packageJsonUpdates)

          // Create pull request
          const pr = await gitProvider.createPullRequest({
            title: prTitle,
            body: prBody,
            head: branchName,
            base: this.config.repository.baseBranch || 'main',
            draft: false,
            reviewers: this.config.pullRequest?.reviewers,
            labels: this.config.pullRequest?.labels || ['dependencies'],
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
   * Generate package.json file changes for updates
   */
  private async generatePackageJsonUpdates(updates: PackageUpdate[]): Promise<Array<{ path: string, content: string, type: 'update' }>> {
    const packageJsonPath = 'package.json'

    // Read current package.json
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8')
    const packageJson = JSON.parse(packageJsonContent)

    // Apply updates
    for (const update of updates) {
      // Find which dependency type this package belongs to
      if (packageJson.dependencies && packageJson.dependencies[update.name]) {
        packageJson.dependencies[update.name] = `^${update.newVersion}`
      }
      else if (packageJson.devDependencies && packageJson.devDependencies[update.name]) {
        packageJson.devDependencies[update.name] = `^${update.newVersion}`
      }
      else if (packageJson.peerDependencies && packageJson.peerDependencies[update.name]) {
        packageJson.peerDependencies[update.name] = `^${update.newVersion}`
      }
    }

    // Generate new package.json content
    const newContent = `${JSON.stringify(packageJson, null, 2)}\n`

    return [{
      path: packageJsonPath,
      content: newContent,
      type: 'update' as const,
    }]
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
    // Normalize titles by removing timestamps and similar variations
    const normalize = (title: string) =>
      title.toLowerCase()
        .replace(/\b(non-major|major|minor|patch)\b/g, '') // Remove update type words
        .replace(/\b\d+\b/g, '') // Remove numbers
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim()

    const normalizedExisting = normalize(existingTitle)
    const normalizedNew = normalize(newTitle)

    // Check if titles are similar (considering common dependency update patterns)
    return normalizedExisting === normalizedNew ||
           existingTitle.includes('dependency') && newTitle.includes('dependency') ||
           existingTitle.includes('update') && newTitle.includes('update')
  }

  /**
   * Check if existing PR body contains the same package updates
   */
  private checkIfUpdatesMatch(existingPRBody: string, newUpdates: PackageUpdate[]): boolean {
    if (!existingPRBody) return false

    // Extract package names and versions from the existing PR body
    const packageRegex = /([a-zA-Z0-9@\-_./]+):\s*(\d+\.\d+\.\d+[^\s]*)\s*→\s*(\d+\.\d+\.\d+[^\s]*)/g
    const existingUpdates = new Map<string, { from: string, to: string }>()

    let match
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
}
