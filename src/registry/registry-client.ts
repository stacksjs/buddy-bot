import type { PackageMetadata, PackageUpdate } from '../types'
import type { Logger } from '../utils/logger'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
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
      // Get updates from bun outdated (compares installed vs available)
      const bunResults = await this.runBunOutdated(filter)

      // Get updates from package.json comparison (package.json version vs latest available)
      const packageJsonResults = await this.getPackageJsonOutdated(filter)

      // Merge results, prioritizing bun outdated for current version info
      const allResults = new Map<string, BunOutdatedResult>()

      // Add bun outdated results first
      for (const result of bunResults) {
        allResults.set(result.name, result)
      }

      // Add package.json results if not already present or if they show a different issue
      for (const result of packageJsonResults) {
        const existing = allResults.get(result.name)
        if (!existing) {
          // Package not in bun outdated, but package.json has old version
          allResults.set(result.name, result)
        }
      }

      const updates: PackageUpdate[] = []

      for (const result of allResults.values()) {
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
   * Get package metadata from registry using bun
   */
  async getPackageMetadata(packageName: string): Promise<PackageMetadata | undefined> {
    try {
      // Use bun info to get package metadata
      const result = await this.runCommand('bun', ['info', packageName, '--json'])
      const data = JSON.parse(result)

      return {
        name: data.name,
        description: data.description,
        repository: typeof data.repository === 'string' ? data.repository : data.repository?.url,
        homepage: data.homepage,
        license: data.license,
        author: typeof data.author === 'string' ? data.author : data.author?.name,
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
      await this.runCommand('bun', ['info', packageName])
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
      const result = await this.runCommand('bun', ['info', packageName, '--json'])
      const data = JSON.parse(result)
      return data.version?.trim() || null
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
    catch (error) {
      this.logger.error('Failed to run bun outdated:', error)
      throw new PackageRegistryError('bun outdated command failed')
    }
  }

  /**
   * Parse bun outdated command output
   */
  private parseBunOutdatedOutput(output: string): BunOutdatedResult[] {
    const results: BunOutdatedResult[] = []

    // Remove ANSI color codes
    const ansiEscape = `${String.fromCharCode(27)}[`
    const cleanOutput = output.replace(new RegExp(`${ansiEscape}[0-9;]*m`, 'g'), '')
    const cleanLines = cleanOutput.split('\n').filter(line => line.trim())

    // Skip header lines and parse table format
    let dataStarted = false
    for (const line of cleanLines) {
      if (line.includes('Package') && line.includes('Current') && line.includes('Update')) {
        dataStarted = true
        continue
      }

      if (!dataStarted || !line.trim())
        continue

      // Skip lines that are just separators (both | and Unicode characters)
      if (line.match(/^[│├─┼┤└┴┘┌┬┐|\-\s]+$/))
        continue

      // Parse table format - handle both | and │ separators
      let parts: string[]
      if (line.includes('│')) {
        // Unicode box-drawing characters (terminal output)
        parts = line.split('│').map(part => part.trim())
      }
      else {
        // Regular pipe characters (programmatic output)
        parts = line.split('|').map(part => part.trim())
      }

      if (parts.length >= 4) {
        // For Unicode format, indices are 1,2,3,4 (first is empty)
        // For pipe format, indices are 1,2,3,4 (first is empty)
        const name = parts[1]?.trim() || ''
        const current = parts[2]?.trim() || ''
        const update = parts[3]?.trim() || ''
        const latest = parts[4]?.trim() || ''

        if (name && current && latest && name !== 'Package') {
          results.push({
            name,
            current,
            update,
            latest,
          })
        }
      }
    }

    return results
  }

  /**
   * Check package.json versions against latest available versions
   */
  private async getPackageJsonOutdated(filter?: string): Promise<BunOutdatedResult[]> {
    try {
      const packageJsonPath = path.join(this.projectPath, 'package.json')

      if (!fs.existsSync(packageJsonPath)) {
        return []
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      }

      const results: BunOutdatedResult[] = []
      const packageNames = Object.keys(allDeps)

      // Apply filter if provided
      const filteredPackages = filter
        ? packageNames.filter(name => filter.split(' ').some(f => name.includes(f)))
        : packageNames

      for (const packageName of filteredPackages) {
        const packageJsonVersion = allDeps[packageName]
        if (!packageJsonVersion)
          continue

        // Get the actual version from package.json (strip caret, tilde, etc.)
        const cleanVersion = this.cleanVersionRange(packageJsonVersion)

        // Get latest version from registry
        const latestVersion = await this.getLatestVersion(packageName)
        if (!latestVersion)
          continue

        // Check if package.json version is older than latest using Bun's semver
        if (Bun.semver.order(cleanVersion, latestVersion) < 0) {
          results.push({
            name: packageName,
            current: cleanVersion,
            update: latestVersion,
            latest: latestVersion,
          })
        }
      }

      return results
    }
    catch (error) {
      this.logger.warn('Failed to check package.json versions:', error)
      return []
    }
  }

  /**
   * Clean version range to get the base version (remove ^, ~, etc.)
   */
  private cleanVersionRange(version: string): string {
    // Remove common range indicators
    return version.replace(/^[\^~>=<]/, '').trim()
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

  /**
   * Search packages using npm registry API (doesn't require npm CLI)
   */
  async searchPackages(query: string, limit = 10): Promise<Array<{
    name: string
    version: string
    description?: string
    keywords?: string[]
  }>> {
    try {
      const encodedQuery = encodeURIComponent(query)
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodedQuery}&size=${limit}`

      // Use fetch if available, otherwise use bun's built-in fetch
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json() as any

      return data.objects?.map((obj: any) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
        keywords: obj.package.keywords,
      })) || []
    }
    catch (error) {
      this.logger.warn(`Failed to search packages via registry API:`, error)
      return []
    }
  }
}
