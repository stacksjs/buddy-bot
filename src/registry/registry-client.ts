import type {
  Logger,
  PackageMetadata,
  PackageUpdate,
} from '../types'
import { spawn } from 'node:child_process'
import { PackageRegistryError } from '../types'
import { getUpdateType } from '../utils/helpers'

export interface BunOutdatedResult {
  name: string
  current: string
  update: string
  latest: string
}

export class RegistryClient {
  constructor(
    private readonly projectPath: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Get outdated packages using bun outdated command
   */
  async getOutdatedPackages(filter?: string): Promise<PackageUpdate[]> {
    this.logger.info('Checking for outdated packages...')

    try {
      const bunResults = await this.runBunOutdated(filter)
      const updates: PackageUpdate[] = []

      for (const result of bunResults) {
        const updateType = getUpdateType(result.current, result.latest)

        // Get additional metadata for the package
        const metadata = await this.getPackageMetadata(result.name)

        updates.push({
          name: result.name,
          currentVersion: result.current,
          newVersion: result.latest,
          updateType,
          dependencyType: 'dependencies', // Will be refined based on package.json analysis
          file: 'package.json', // Will be refined based on actual file location
          metadata,
          releaseNotesUrl: this.getReleaseNotesUrl(result.name, metadata),
          changelogUrl: this.getChangelogUrl(result.name, metadata),
          homepage: metadata?.homepage,
        })
      }

      this.logger.success(`Found ${updates.length} package updates`)
      return updates
    }
    catch (error) {
      this.logger.error('Failed to check for outdated packages:', error)
      throw new PackageRegistryError(
        `Failed to check for outdated packages: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Get updates for specific packages
   */
  async getUpdatesForPackages(packageNames: string[]): Promise<PackageUpdate[]> {
    const filter = packageNames.join(' ')
    return this.getOutdatedPackages(filter)
  }

  /**
   * Get updates using glob patterns
   */
  async getUpdatesWithPattern(pattern: string): Promise<PackageUpdate[]> {
    return this.getOutdatedPackages(pattern)
  }

  /**
   * Get package metadata from npm registry
   */
  async getPackageMetadata(packageName: string): Promise<PackageMetadata | undefined> {
    try {
      // Use bun's built-in registry access or npm view
      const result = await this.runCommand('npm', ['view', packageName, '--json'])
      const data = JSON.parse(result)

      return {
        name: data.name,
        description: data.description,
        repository: typeof data.repository === 'string' ? data.repository : data.repository?.url,
        homepage: data.homepage,
        license: data.license,
        author: data.author,
        keywords: data.keywords,
        latestVersion: data.version,
        versions: data.versions || [data.version],
        weeklyDownloads: undefined, // Would need separate API call
        dependencies: data.dependencies,
        devDependencies: data.devDependencies,
        peerDependencies: data.peerDependencies,
      }
    }
    catch (error) {
      this.logger.warn(`Failed to get metadata for ${packageName}:`, error)
      return undefined
    }
  }

  /**
   * Check if package exists in registry
   */
  async packageExists(packageName: string): Promise<boolean> {
    try {
      await this.runCommand('npm', ['view', packageName, 'name'])
      return true
    }
    catch {
      return false
    }
  }

  /**
   * Get latest version of a package
   */
  async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const result = await this.runCommand('npm', ['view', packageName, 'version'])
      return result.trim()
    }
    catch {
      return null
    }
  }

  /**
   * Run bun outdated command and parse results
   */
  private async runBunOutdated(filter?: string): Promise<BunOutdatedResult[]> {
    const args = ['outdated']
    if (filter) {
      args.push(...filter.split(' '))
    }

    try {
      const output = await this.runCommand('bun', args)
      return this.parseBunOutdatedOutput(output)
    }
    catch {
      // If bun is not available, fall back to npm outdated
      this.logger.warn('Bun not available, falling back to npm outdated')
      try {
        const output = await this.runCommand('npm', ['outdated', '--json'])
        return this.parseNpmOutdatedOutput(output)
      }
      catch {
        throw new PackageRegistryError('Neither bun nor npm outdated commands are available')
      }
    }
  }

  /**
   * Parse bun outdated command output
   */
  private parseBunOutdatedOutput(output: string): BunOutdatedResult[] {
    const lines = output.split('\n').filter(line => line.trim())
    const results: BunOutdatedResult[] = []

    // Skip header lines and parse table format
    let dataStarted = false
    for (const line of lines) {
      if (line.includes('Package') && line.includes('Current') && line.includes('Update')) {
        dataStarted = true
        continue
      }

      if (!dataStarted || !line.trim())
        continue

      // Parse table format: Package | Current | Update | Latest
      const parts = line.split('|').map(part => part.trim())
      if (parts.length >= 4) {
        results.push({
          name: parts[0],
          current: parts[1],
          update: parts[2],
          latest: parts[3],
        })
      }
    }

    return results
  }

  /**
   * Parse npm outdated JSON output
   */
  private parseNpmOutdatedOutput(output: string): BunOutdatedResult[] {
    try {
      const data = JSON.parse(output)
      const results: BunOutdatedResult[] = []

      for (const [name, info] of Object.entries(data)) {
        const packageInfo = info as any
        results.push({
          name,
          current: packageInfo.current,
          update: packageInfo.wanted,
          latest: packageInfo.latest,
        })
      }

      return results
    }
    catch {
      // If JSON parsing fails, return empty array
      return []
    }
  }

  /**
   * Run a command and return its output
   */
  private async runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.projectPath,
        stdio: 'pipe',
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

  /**
   * Generate release notes URL based on package metadata
   */
  private getReleaseNotesUrl(packageName: string, metadata?: PackageMetadata): string | undefined {
    if (!metadata?.repository)
      return undefined

    // Extract GitHub repo URL
    const repoMatch = metadata.repository.match(/github\.com[/:]([^/]+\/[^/]+)/)
    if (repoMatch) {
      const repoPath = repoMatch[1].replace('.git', '')
      return `https://github.com/${repoPath}/releases`
    }

    return undefined
  }

  /**
   * Generate changelog URL based on package metadata
   */
  private getChangelogUrl(packageName: string, metadata?: PackageMetadata): string | undefined {
    if (!metadata?.repository)
      return undefined

    // Extract GitHub repo URL
    const repoMatch = metadata.repository.match(/github\.com[/:]([^/]+\/[^/]+)/)
    if (repoMatch) {
      const repoPath = repoMatch[1].replace('.git', '')
      return `https://github.com/${repoPath}/blob/main/CHANGELOG.md`
    }

    return undefined
  }

  /**
   * Filter updates by workspace (for monorepos)
   */
  async getUpdatesForWorkspace(workspaceName: string): Promise<PackageUpdate[]> {
    try {
      const args = ['outdated', '--filter', workspaceName]
      const output = await this.runCommand('bun', args)
      const bunResults = this.parseBunOutdatedOutput(output)

      const updates: PackageUpdate[] = []
      for (const result of bunResults) {
        const updateType = getUpdateType(result.current, result.latest)
        const metadata = await this.getPackageMetadata(result.name)

        updates.push({
          name: result.name,
          currentVersion: result.current,
          newVersion: result.latest,
          updateType,
          dependencyType: 'dependencies',
          file: `${workspaceName}/package.json`,
          metadata,
          releaseNotesUrl: this.getReleaseNotesUrl(result.name, metadata),
          changelogUrl: this.getChangelogUrl(result.name, metadata),
          homepage: metadata?.homepage,
        })
      }

      return updates
    }
    catch (error) {
      this.logger.warn(`Failed to get updates for workspace ${workspaceName}:`, error)
      return []
    }
  }
}
