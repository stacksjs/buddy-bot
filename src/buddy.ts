import type {
  BuddyBotConfig,
  PackageFile,
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

      // Merge all updates
      let updates = [...packageJsonUpdates, ...dependencyFileUpdates]

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
            (pr.title === prTitle
              || pr.head.startsWith(branchPattern)
              || this.isSimilarPRTitle(pr.title, prTitle))
            && (pr.author === 'github-actions[bot]' || pr.author.includes('buddy') || pr.head.startsWith('buddy-bot/')),
          )

          if (existingPR) {
            this.logger.info(`🔄 Found existing PR #${existingPR.number}: ${existingPR.title}`)

            // Check if the updates are the same by comparing package lists
            const existingUpdatesMatch = this.checkIfUpdatesMatch(existingPR.body, group.updates)

            if (existingUpdatesMatch) {
              this.logger.info(`✅ Existing PR has the same updates, skipping creation`)
              continue
            }
            else {
              this.logger.info(`🔄 Updates differ, will update existing PR with new content`)

              // Generate dynamic labels for the update
              const dynamicLabels = this.generatePRLabels(group)

              // Update existing PR with new content
              await gitProvider.updatePullRequest(existingPR.number, {
                title: prTitle,
                body: prBody,
                labels: dynamicLabels,
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

          // Update package.json with new versions
          const packageJsonUpdates = await this.generatePackageJsonUpdates(group.updates)

          // Commit changes
          await gitProvider.commitChanges(branchName, group.title, packageJsonUpdates)

          // Generate dynamic labels based on update types
          const dynamicLabels = this.generatePRLabels(group)

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
          // Compare constraint version with resolved version
          if (dep.constraint !== dep.version && dep.version) {
            // Extract version prefix (^, ~, >=, etc.) from constraint
            const prefixMatch = dep.constraint.match(/^(\D*)/)
            const originalPrefix = prefixMatch ? prefixMatch[1] : ''
            const constraintVersion = dep.constraint.replace(/^[\^~>=<]+/, '')

            // Determine update type
            const updateType = this.getUpdateType(constraintVersion, dep.version)

            // Preserve the original prefix when creating new version
            const newVersion = `${originalPrefix}${dep.version}`

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
   * Determine update type based on version comparison
   */
  private getUpdateType(current: string, latest: string): 'major' | 'minor' | 'patch' {
    try {
      const currentParts = current.split('.').map(Number)
      const latestParts = latest.split('.').map(Number)

      if (latestParts[0] > currentParts[0])
        return 'major'
      if (latestParts[1] > currentParts[1])
        return 'minor'
      return 'patch'
    }
    catch {
      return 'patch' // Default to patch if parsing fails
    }
  }

  /**
   * Generate file changes for updates (package.json, dependency files, etc.)
   */
  async generatePackageJsonUpdates(updates: PackageUpdate[]): Promise<Array<{ path: string, content: string, type: 'update' }>> {
    const fileUpdates: Array<{ path: string, content: string, type: 'update' }> = []

    // Handle package.json updates
    const packageJsonUpdates = updates.filter(update => update.file === 'package.json' || (!update.file.includes('.yaml') && !update.file.includes('.yml')))
    if (packageJsonUpdates.length > 0) {
      const packageJsonPath = 'package.json'

      // Read current package.json content as string to preserve formatting
      let packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8')

      // Parse to understand structure
      const packageJson = JSON.parse(packageJsonContent)

      // Apply updates using string replacement to preserve formatting
      for (const update of packageJsonUpdates) {
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
          console.warn(`Package ${cleanPackageName} not found in package.json`)
        }
      }

      fileUpdates.push({
        path: packageJsonPath,
        content: packageJsonContent,
        type: 'update' as const,
      })
    }

    // Handle dependency file updates (deps.yaml, dependencies.yaml, etc.)
    try {
      const { generateDependencyFileUpdates } = await import('./utils/dependency-file-parser')
      const dependencyFileUpdates = await generateDependencyFileUpdates(updates)
      fileUpdates.push(...dependencyFileUpdates)
    }
    catch (error) {
      this.logger.error('Failed to generate dependency file updates:', error)
      // Continue with package.json updates even if dependency file updates fail
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
    return normalizedExisting === normalizedNew
      || (existingTitle.includes('dependency') && newTitle.includes('dependency'))
      || (existingTitle.includes('update') && newTitle.includes('update'))
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
      labels.add('bulk-update')
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
