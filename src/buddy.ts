import type {
  BuddyBotConfig,
  UpdateScanResult,
  PackageUpdate,
  UpdateGroup,
  Logger as ILogger
} from './types'
import { PackageScanner } from './scanner/package-scanner'
import { RegistryClient } from './registry/registry-client'
import { Logger } from './utils/logger'
import { groupUpdates, sortUpdatesByPriority } from './utils/helpers'

export class Buddy {
  private readonly logger: ILogger
  private readonly scanner: PackageScanner
  private readonly registryClient: RegistryClient

  constructor(
    private readonly config: BuddyBotConfig,
    private readonly projectPath: string = process.cwd()
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
      } else {
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
        duration
      }

      this.logger.success(`Scan completed in ${duration}ms. Found ${updates.length} updates.`)
      return result
    } catch (error) {
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
      // For now, we'll create placeholder PR logic
      // This will be implemented when we add Git providers
      for (const group of scanResult.groups) {
        this.logger.info(`Would create PR for group: ${group.name} (${group.updates.length} updates)`)
        this.logger.debug(`PR Title: ${group.title}`)
        this.logger.debug(`Updates: ${group.updates.map(u => `${u.name}@${u.newVersion}`).join(', ')}`)
      }

      this.logger.success(`Would create ${scanResult.groups.length} pull request(s)`)
    } catch (error) {
      this.logger.error('Failed to create pull requests:', error)
      throw error
    }
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
    strategy: 'major' | 'minor' | 'patch' | 'all'
  ): PackageUpdate[] {
    if (strategy === 'all') return updates

    return updates.filter(update => {
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
          matchingUpdates.forEach(update => {
            const index = ungroupedUpdates.indexOf(update)
            if (index > -1) ungroupedUpdates.splice(index, 1)
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
            body: `Update ${filteredUpdates.length} packages in ${groupConfig.name} group`
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
    if (updates.some(u => u.updateType === 'major')) return 'major'
    if (updates.some(u => u.updateType === 'minor')) return 'minor'
    return 'patch'
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
