import type { BuddyBotConfig, PackageMetadata, PackageUpdate } from '../types'
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
    private readonly config: BuddyBotConfig | undefined = undefined,
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

      // Also check for Composer packages if composer.json exists
      const fs = await import('node:fs')
      const path = await import('node:path')
      const composerJsonPath = path.join(this.projectPath, 'composer.json')

      if (fs.existsSync(composerJsonPath)) {
        try {
          const composerUpdates = await this.getComposerOutdatedPackages()
          updates.push(...composerUpdates)
        }
        catch (error) {
          this.logger.warn('Failed to check Composer packages:', error)
        }
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
      // First try to get all available versions from npm registry
      const npmLatest = await this.getLatestVersionFromNpm(packageName)
      if (npmLatest) {
        return npmLatest
      }

      // Fallback to bun info
      const result = await this.runCommand('bun', ['info', packageName, '--json'])
      const data = JSON.parse(result)
      return data.version?.trim() || null
    }
    catch {
      return null
    }
  }

  /**
   * Get latest version from npm registry (respecting prerelease settings)
   */
  private async getLatestVersionFromNpm(packageName: string): Promise<string | null> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`)
      if (!response.ok) {
        return null
      }

      const data = await response.json() as any
      const versions = Object.keys(data.versions || {})

      if (versions.length === 0) {
        return null
      }

      // Filter versions based on prerelease setting
      const includePrerelease = this.config?.packages?.includePrerelease ?? false
      let filteredVersions = versions

      if (!includePrerelease) {
        // Filter out prerelease versions (alpha, beta, rc, dev, etc.)
        filteredVersions = versions.filter((version) => {
          return !this.isPrerelease(version)
        })
      }

      if (filteredVersions.length === 0) {
        return null
      }

      // Sort versions using semver and get the latest
      const sortedVersions = filteredVersions.sort((a, b) => {
        try {
          return Bun.semver.order(b, a) // Reverse order for descending
        }
        catch {
          return 0
        }
      })

      return sortedVersions[0] || null
    }
    catch (error) {
      this.logger.warn(`Failed to get npm version for ${packageName}:`, error)
      return null
    }
  }

  /**
   * Check if a version is a prerelease (contains alpha, beta, rc, dev, etc.)
   */
  private isPrerelease(version: string): boolean {
    const prereleasePattern = /-(?:alpha|beta|rc|dev|canary|next|experimental|snapshot|nightly)/i
    return prereleasePattern.test(version)
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
        let name = parts[1]?.trim() || ''
        const current = parts[2]?.trim() || ''
        const update = parts[3]?.trim() || ''
        const latest = parts[4]?.trim() || ''

        // Clean package name - remove dependency type suffixes that bun outdated adds
        name = name.replace(/\s*\(dev\)$/, '').replace(/\s*\(peer\)$/, '').replace(/\s*\(optional\)$/, '')

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

        // Skip ignored packages
        const ignoredPackages = this.config?.packages?.ignore || []
        if (ignoredPackages.includes(packageName)) {
          continue
        }

        // Get the actual version from package.json (strip caret, tilde, etc.)
        const cleanVersion = this.cleanVersionRange(packageJsonVersion)

        // Get latest version from registry
        const latestVersion = await this.getLatestVersion(packageName)
        if (!latestVersion)
          continue

        // Check if package.json version is older than latest using Bun's semver
        if (Bun.semver.order(cleanVersion, latestVersion) < 0) {
          // Check if this is a major update and if major updates are excluded
          const updateType = getUpdateType(cleanVersion, latestVersion)
          const excludeMajor = this.config?.packages?.excludeMajor ?? false

          if (excludeMajor && updateType === 'major') {
            continue
          }

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

  /**
   * Extract major version number from a version string
   */
  private getMajorVersion(version: string): string {
    return version.replace(/^[v^~>=<]+/, '').split('.')[0] || '0'
  }

  /**
   * Extract minor version number from a version string
   */
  private getMinorVersion(version: string): string {
    const parts = version.replace(/^[v^~>=<]+/, '').split('.')
    return parts[1] || '0'
  }

  /**
   * Get outdated Composer packages
   */
  async getComposerOutdatedPackages(): Promise<PackageUpdate[]> {
    this.logger.info('Checking for outdated Composer packages...')
    const updates: PackageUpdate[] = []

    try {
      // First check if composer is available
      console.log('🔍 Checking Composer availability...')
      try {
        const composerVersion = await this.runCommand('composer', ['--version'])
        console.log('✅ Composer version:', composerVersion.split('\n')[0])
      }
      catch (error) {
        console.log('❌ Composer not available:', error)
        this.logger.warn('Composer not found, skipping Composer package updates')
        return []
      }

      // First, let's log what composer.json contains
      const composerJsonPath = path.join(process.cwd(), 'composer.json')
      console.log(`🔍 Reading composer.json from: ${composerJsonPath}`)

      if (!fs.existsSync(composerJsonPath)) {
        console.log('❌ composer.json not found')
        return []
      }

      const composerJsonContent = fs.readFileSync(composerJsonPath, 'utf8')
      const composerJsonData = JSON.parse(composerJsonContent)

      console.log('📦 composer.json require packages:', Object.keys(composerJsonData.require || {}))
      console.log('📦 composer.json require-dev packages:', Object.keys(composerJsonData['require-dev'] || {}))

      // Run composer outdated to get available updates (including require-dev packages)
      console.log('🔍 Running composer outdated (including dev dependencies)...')
      const composerOutput = await this.runCommand('composer', ['outdated', '--format=json'])
      console.log('📊 Raw composer outdated output length:', composerOutput.length)

      let composerData: any
      try {
        composerData = JSON.parse(composerOutput)
        console.log(`📋 Composer outdated found ${composerData.installed?.length || 0} packages`)
      }
      catch (parseError) {
        console.log('❌ Failed to parse composer outdated JSON:', parseError)
        console.log('Raw output:', composerOutput.substring(0, 500))
        return []
      }

      // Parse composer outdated output and find multiple update paths per package
      if (composerData.installed) {
        console.log('🔄 Processing outdated packages...')
        for (const pkg of composerData.installed) {
          console.log(`\n📦 Processing package: ${pkg.name}`)
          console.log(`   Current version: ${pkg.version}`)
          console.log(`   Latest version: ${pkg.latest}`)

          if (pkg.name && pkg.version && pkg.latest) {
            // Get the version constraint from composer.json
            const requireConstraint = composerJsonData.require?.[pkg.name]
            const requireDevConstraint = composerJsonData['require-dev']?.[pkg.name]
            const constraint = requireConstraint || requireDevConstraint

            console.log(`   Constraint: ${constraint || 'NOT FOUND'}`)

            if (!constraint) {
              console.log(`   ⚠️  Skipping ${pkg.name} - not found in composer.json`)
              continue // Skip packages not found in composer.json
            }

            // Skip ignored packages
            const ignoredPackages = this.config?.packages?.ignore || []
            if (ignoredPackages.includes(pkg.name)) {
              console.log(`   ⚠️  Skipping ${pkg.name} - in ignore list`)
              continue
            }

            // Determine dependency type by checking composer.json
            let dependencyType: 'require' | 'require-dev' = 'require'
            if (composerJsonData['require-dev'] && composerJsonData['require-dev'][pkg.name]) {
              dependencyType = 'require-dev'
            }
            console.log(`   Dependency type: ${dependencyType}`)

            // Get additional metadata for the package
            const metadata = await this.getComposerPackageMetadata(pkg.name)

            // Find multiple update paths: patch, minor, and major
            // Extract the base version from the constraint (e.g., "^3.0" -> "3.0.0")
            const constraintBaseVersion = this.extractConstraintBaseVersion(constraint)
            console.log(`   Constraint base version: ${constraintBaseVersion}`)

            // Always use constraint base version for consistent detection across environments
            // This ensures we detect updates based on composer.json constraints, not installed versions
            if (!constraintBaseVersion) {
              console.warn(`❌ Could not extract base version from constraint "${constraint}" for ${pkg.name}`)
              continue
            }

            const currentVersion = constraintBaseVersion
            const latestVersion = pkg.latest
            console.log(`   Using current version: ${currentVersion} (from constraint)`)
            console.log(`   Target latest version: ${latestVersion}`)

            // Get all available versions by querying composer show
            let availableVersions: string[] = []
            try {
              console.log(`   🔍 Getting available versions for ${pkg.name}...`)
              const showOutput = await this.runCommand('composer', ['show', pkg.name, '--available', '--format=json'])
              const showData = JSON.parse(showOutput)
              if (showData.versions) {
                availableVersions = showData.versions // This is already an array of version strings
                console.log(`   📋 Found ${availableVersions.length} available versions`)
              }
            }
            catch (error) {
              console.warn(`❌ Failed to get available versions for ${pkg.name}, using latest only:`, error)
              availableVersions = [latestVersion]
            }

            // Find the best constraint updates (e.g., ^3.0 -> ^3.9.0)
            console.log(`   🎯 Finding best constraint updates...`)
            const updateCandidates = await this.findBestConstraintUpdates(constraint, availableVersions, currentVersion)
            console.log(`   📊 Found ${updateCandidates.length} update candidates`)

            for (const candidate of updateCandidates) {
              const updateType = getUpdateType(currentVersion, candidate.version)
              console.log(`   📈 Update candidate: ${currentVersion} → ${candidate.version} (${updateType})`)

              // Check if this update type should be excluded
              const excludeMajor = this.config?.packages?.excludeMajor ?? false
              if (excludeMajor && updateType === 'major') {
                console.log(`   ⚠️  Skipping major update for ${pkg.name} - excludeMajor is true`)
                continue
              }

              console.log(`   ✅ Adding update: ${pkg.name} ${currentVersion} → ${candidate.version}`)
              updates.push({
                name: pkg.name,
                currentVersion,
                newVersion: candidate.version,
                updateType,
                dependencyType,
                file: 'composer.json',
                metadata,
                releaseNotesUrl: this.getComposerReleaseNotesUrl(pkg.name, metadata),
                changelogUrl: this.getComposerChangelogUrl(pkg.name, metadata),
                homepage: metadata?.homepage,
              })
            }
          }
        }
      }

      console.log(`✅ Final result: Found ${updates.length} Composer package updates`)
      this.logger.success(`Found ${updates.length} Composer package updates`)
      return updates
    }
    catch (error) {
      this.logger.warn('Failed to check for outdated Composer packages:', error)
      return []
    }
  }

  /**
   * Find the best patch, minor, and major updates for a package
   */
  private async findBestUpdates(currentVersion: string, availableVersions: string[], _constraint: string): Promise<{ version: string, type: 'patch' | 'minor' | 'major' }[]> {
    const { getUpdateType } = await import('../utils/helpers')
    const candidates: { version: string, type: 'patch' | 'minor' | 'major' }[] = []

    // Parse current version
    const currentParts = this.parseVersion(currentVersion)
    if (!currentParts) {
      return []
    }

    let bestPatch: string | null = null
    let bestMinor: string | null = null
    let bestMajor: string | null = null

    for (const version of availableVersions) {
      // Skip dev/alpha/beta versions for now (could be enhanced later)
      if (version.includes('dev') || version.includes('alpha') || version.includes('beta') || version.includes('RC')) {
        continue
      }

      const versionParts = this.parseVersion(version)
      if (!versionParts) {
        continue
      }

      // Skip versions that are not newer
      const comparison = this.compareVersions(version, currentVersion)
      if (comparison <= 0) {
        continue
      }

      const updateType = getUpdateType(currentVersion, version)

      // Find best update for each type
      if (updateType === 'patch' && versionParts.major === currentParts.major && versionParts.minor === currentParts.minor) {
        if (!bestPatch || this.compareVersions(version, bestPatch) > 0) {
          bestPatch = version
        }
      }
      else if (updateType === 'minor' && versionParts.major === currentParts.major) {
        if (!bestMinor || this.compareVersions(version, bestMinor) > 0) {
          bestMinor = version
        }
      }
      else if (updateType === 'major') {
        if (!bestMajor || this.compareVersions(version, bestMajor) > 0) {
          bestMajor = version
        }
      }
    }

    // Add the best candidates
    if (bestPatch) {
      candidates.push({ version: bestPatch, type: 'patch' })
    }
    if (bestMinor) {
      candidates.push({ version: bestMinor, type: 'minor' })
    }
    if (bestMajor) {
      candidates.push({ version: bestMajor, type: 'major' })
    }

    return candidates
  }

  /**
   * Parse a version string into major.minor.patch
   */
  private parseVersion(version: string): { major: number, minor: number, patch: number } | null {
    // Remove 'v' prefix and any pre-release identifiers
    const cleanVersion = version.replace(/^v/, '').split('-')[0].split('+')[0]
    const parts = cleanVersion.split('.').map(p => Number.parseInt(p, 10))

    if (parts.length < 2 || parts.some(p => Number.isNaN(p))) {
      return null
    }

    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
    }
  }

  /**
   * Compare two version strings
   * Returns: -1 if a < b, 0 if a === b, 1 if a > b
   */
  private compareVersions(a: string, b: string): number {
    const parseA = this.parseVersion(a)
    const parseB = this.parseVersion(b)

    if (!parseA || !parseB)
      return 0

    if (parseA.major !== parseB.major)
      return parseA.major - parseB.major
    if (parseA.minor !== parseB.minor)
      return parseA.minor - parseB.minor
    return parseA.patch - parseB.patch
  }

  /**
   * Get Composer package metadata from Packagist
   */
  async getComposerPackageMetadata(packageName: string): Promise<PackageMetadata | undefined> {
    try {
      const response = await fetch(`https://packagist.org/packages/${packageName}.json`)

      if (!response.ok) {
        return undefined
      }

      const data = await response.json() as any
      const packageData = data.package

      if (!packageData) {
        return undefined
      }

      // Get the latest version info
      const versions = Object.keys(packageData.versions || {})
      const latestVersion = versions.find(v => !v.includes('dev') && !v.includes('alpha') && !v.includes('beta')) || versions[0]
      const versionData = packageData.versions[latestVersion] || {}

      return {
        name: packageData.name,
        description: versionData.description,
        repository: versionData.source?.url || versionData.homepage,
        homepage: versionData.homepage,
        license: Array.isArray(versionData.license) ? versionData.license.join(', ') : versionData.license,
        author: versionData.authors?.[0]?.name,
        keywords: versionData.keywords,
        latestVersion,
        versions,
        weeklyDownloads: packageData.downloads?.monthly, // Packagist provides monthly, not weekly
        dependencies: versionData.require,
        devDependencies: versionData['require-dev'],
      }
    }
    catch (error) {
      this.logger.warn(`Failed to get Composer metadata for ${packageName}:`, error)
      return undefined
    }
  }

  /**
   * Check if a Composer package exists in Packagist
   */
  async composerPackageExists(packageName: string): Promise<boolean> {
    try {
      const response = await fetch(`https://packagist.org/packages/${packageName}.json`)
      return response.ok
    }
    catch {
      return false
    }
  }

  /**
   * Get latest version of a Composer package from Packagist
   */
  async getComposerLatestVersion(packageName: string): Promise<string | null> {
    try {
      const response = await fetch(`https://packagist.org/packages/${packageName}.json`)

      if (!response.ok) {
        return null
      }

      const data = await response.json() as any
      const packageData = data.package

      if (!packageData?.versions) {
        return null
      }

      // Get stable versions only (exclude dev, alpha, beta)
      const versions = Object.keys(packageData.versions)
      const stableVersions = versions.filter(v =>
        !v.includes('dev')
        && !v.includes('alpha')
        && !v.includes('beta')
        && !v.includes('rc'),
      )

      if (stableVersions.length === 0) {
        return versions[0] || null
      }

      // Sort versions and get the latest stable
      const sortedVersions = stableVersions.sort((a, b) => {
        try {
          // Use built-in version comparison if available
          if (typeof Bun !== 'undefined' && Bun.semver) {
            return Bun.semver.order(a, b)
          }
          // Fallback to string comparison
          return a.localeCompare(b, undefined, { numeric: true })
        }
        catch {
          return a.localeCompare(b)
        }
      })

      return sortedVersions[sortedVersions.length - 1] || null
    }
    catch (error) {
      this.logger.warn(`Failed to get latest Composer version for ${packageName}:`, error)
      return null
    }
  }

  /**
   * Generate release notes URL for Composer packages
   */
  private getComposerReleaseNotesUrl(packageName: string, metadata?: PackageMetadata): string | undefined {
    if (!metadata?.repository) {
      return undefined
    }

    // Extract GitHub repo URL
    const repoMatch = metadata.repository.match(/github\.com[/:]([^/]+\/[^/]+)/)
    if (repoMatch) {
      const repoPath = repoMatch[1].replace('.git', '')
      return `https://github.com/${repoPath}/releases`
    }

    return undefined
  }

  /**
   * Generate changelog URL for Composer packages
   */
  private getComposerChangelogUrl(packageName: string, metadata?: PackageMetadata): string | undefined {
    if (!metadata?.repository) {
      return undefined
    }

    // Extract GitHub repo URL
    const repoMatch = metadata.repository.match(/github\.com[/:]([^/]+\/[^/]+)/)
    if (repoMatch) {
      const repoPath = repoMatch[1].replace('.git', '')
      return `https://github.com/${repoPath}/blob/main/CHANGELOG.md`
    }

    return undefined
  }

  /**
   * Extract the base version from a version constraint (e.g., "^3.0" -> "3.0.0")
   */
  private extractConstraintBaseVersion(constraint: string): string | null {
    const match = constraint.match(/^[\^~>=<]*([\d.]+)/)
    if (match) {
      return match[1]
    }
    return null
  }

  /**
   * Find the best constraint updates (e.g., ^3.0 -> ^3.9.0)
   */
  private async findBestConstraintUpdates(constraint: string, availableVersions: string[], currentVersion: string): Promise<{ version: string, type: 'patch' | 'minor' | 'major' }[]> {
    const { getUpdateType } = await import('../utils/helpers')
    const candidates: { version: string, type: 'patch' | 'minor' | 'major' }[] = []

    // Parse current version
    const currentParts = this.parseVersion(currentVersion)
    if (!currentParts) {
      return []
    }

    let bestPatch: string | null = null
    let bestMinor: string | null = null
    let bestMajor: string | null = null

    for (const version of availableVersions) {
      // Skip dev/alpha/beta versions for now (could be enhanced later)
      if (version.includes('dev') || version.includes('alpha') || version.includes('beta') || version.includes('RC')) {
        continue
      }

      const versionParts = this.parseVersion(version)
      if (!versionParts) {
        continue
      }

      // Skip versions that are not newer
      const comparison = this.compareVersions(version, currentVersion)
      if (comparison <= 0) {
        continue
      }

      const updateType = getUpdateType(currentVersion, version)

      // Find best update for each type
      if (updateType === 'patch' && versionParts.major === currentParts.major && versionParts.minor === currentParts.minor) {
        if (!bestPatch || this.compareVersions(version, bestPatch) > 0) {
          bestPatch = version
        }
      }
      else if (updateType === 'minor' && versionParts.major === currentParts.major) {
        if (!bestMinor || this.compareVersions(version, bestMinor) > 0) {
          bestMinor = version
        }
      }
      else if (updateType === 'major') {
        if (!bestMajor || this.compareVersions(version, bestMajor) > 0) {
          bestMajor = version
        }
      }
    }

    // Add the best candidates
    if (bestPatch) {
      candidates.push({ version: bestPatch, type: 'patch' })
    }
    if (bestMinor) {
      candidates.push({ version: bestMinor, type: 'minor' })
    }
    if (bestMajor) {
      candidates.push({ version: bestMajor, type: 'major' })
    }

    return candidates
  }
}
