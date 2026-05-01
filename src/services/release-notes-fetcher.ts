import { semver } from 'bun'
import process from 'node:process'

// Shapes for third-party API responses this service consumes. Narrow and
// defensive — fields we don't touch aren't declared.
interface NpmPackument {
  'dist-tags'?: { latest?: string }
  'description'?: string
  'homepage'?: string
  'repository'?: { type?: string, url?: string } | string
  'license'?: string
  'author'?: unknown
  'keywords'?: string[]
  'time'?: Record<string, string>
  'maintainers'?: unknown[]
}

interface NpmDownloadsResponse {
  downloads?: number
}

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
  content_type: string
}

interface GitHubReleaseResponse {
  tag_name: string
  name?: string
  body?: string
  html_url: string
  published_at: string
  prerelease: boolean
  author?: { login?: string }
  assets?: GitHubReleaseAsset[]
}

interface GitHubContentsResponse {
  content?: string
}

interface PackagistServiceVersion {
  description?: string
  homepage?: string
  license?: string[] | string
  keywords?: string[]
  authors?: unknown[]
  source?: { url?: string }
  time?: string
}

interface PackagistServiceResponse {
  package?: {
    name?: string
    versions?: Record<string, PackagistServiceVersion>
  }
}

export interface ReleaseNote {
  version: string
  date: string
  title: string
  body: string
  htmlUrl: string
  compareUrl?: string
  author?: string
  isPrerelease: boolean
  assets?: ReleaseAsset[]
}

export interface ReleaseAsset {
  name: string
  downloadUrl: string
  size: number
  contentType: string
}

export interface ChangelogEntry {
  version: string
  date: string
  changes: {
    added?: string[]
    changed?: string[]
    deprecated?: string[]
    removed?: string[]
    fixed?: string[]
    security?: string[]
  }
  notes?: string
}

export interface PackageInfo {
  name: string
  description?: string
  homepage?: string
  repository?: {
    type: string
    url: string
    directory?: string
  }
  license?: string
  author?: string | { name: string, email?: string, url?: string }
  keywords?: string[]
  weeklyDownloads?: number
  lastPublish?: string
  maintainers?: Array<{ name: string, email?: string }>
}

export class ReleaseNotesFetcher {
  private readonly userAgent = 'Buddy-Bot/1.0.0 (https://github.com/stacksjs/buddy)'

  /**
   * Fetch comprehensive package information including release notes
   */
  async fetchPackageInfo(packageName: string, currentVersion: string, newVersion: string): Promise<{
    packageInfo: PackageInfo
    releaseNotes: ReleaseNote[]
    changelog: ChangelogEntry[]
    compareUrl?: string
  }> {
    // Return mock data in test mode to avoid network calls
    if (process.env.APP_ENV === 'test') {
      // Special handling for known packages in tests
      const knownPackages: Record<string, { owner: string, repo: string }> = {
        stripe: { owner: 'stripe', repo: 'stripe-node' },
        typescript: { owner: 'microsoft', repo: 'TypeScript' },
        react: { owner: 'facebook', repo: 'react' },
      }

      const repoInfo = knownPackages[packageName] || { owner: 'example', repo: packageName }

      return {
        packageInfo: {
          name: packageName,
          description: `Package ${packageName} description`,
          repository: { type: 'git', url: `https://github.com/${repoInfo.owner}/${repoInfo.repo}` },
        },
        releaseNotes: [],
        changelog: [],
        compareUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/compare/v${currentVersion}...v${newVersion}`,
      }
    }

    try {
      // Fetch basic package info from npm registry
      const packageInfo = await this.fetchNpmPackageInfo(packageName)

      // Try to get release notes from GitHub if repository is available
      let releaseNotes: ReleaseNote[] = []
      let changelog: ChangelogEntry[] = []
      let compareUrl: string | undefined

      if (packageInfo.repository?.url) {
        const githubInfo = this.parseGitHubUrl(packageInfo.repository.url)
        if (githubInfo) {
          releaseNotes = await this.fetchGitHubReleases(githubInfo.owner, githubInfo.repo, currentVersion, newVersion)
          compareUrl = this.generateCompareUrl(githubInfo.owner, githubInfo.repo, currentVersion, newVersion)

          // Try to fetch changelog from repository
          changelog = await this.fetchChangelog(githubInfo.owner, githubInfo.repo)
        }
      }

      return {
        packageInfo,
        releaseNotes,
        changelog,
        compareUrl,
      }
    }
    catch (error) {
      console.error(`❌ Failed to fetch package info for ${packageName}:`, error)
      // Return minimal info that will still generate useful content
      return {
        packageInfo: {
          name: packageName,
          description: `Package ${packageName} - see npm for details`,
          repository: { type: 'git', url: `https://github.com/search?q=${encodeURIComponent(packageName)}&type=repositories` },
        },
        releaseNotes: [],
        changelog: [],
      }
    }
  }

  /**
   * Fetch package information from npm registry
   */
  private async fetchNpmPackageInfo(packageName: string): Promise<PackageInfo> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
        headers: { 'User-Agent': this.userAgent },
      })

      if (!response.ok) {
        throw new Error(`NPM registry responded with ${response.status}`)
      }

      const data = await response.json() as NpmPackument
      const latest = data['dist-tags']?.latest

      // Fetch weekly downloads
      let weeklyDownloads: number | undefined
      try {
        const downloadsResponse = await fetch(
          `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`,
          { headers: { 'User-Agent': this.userAgent } },
        )
        if (downloadsResponse.ok) {
          const downloadsData = await downloadsResponse.json() as NpmDownloadsResponse
          weeklyDownloads = downloadsData.downloads
        }
      }
      catch {
        // Ignore download fetch errors
      }

      // Normalize the polymorphic npm fields into the PackageInfo shape.
      // npm registry returns `repository` as either a string or an object;
      // `author` as either a string or an object; `maintainers` as objects
      // with at least { name, email? }.
      const repository: PackageInfo['repository'] = typeof data.repository === 'string'
        ? { type: 'git', url: data.repository }
        : data.repository?.url
          ? { type: data.repository.type ?? 'git', url: data.repository.url }
          : undefined

      const rawAuthor = data.author
      const author: PackageInfo['author']
        = typeof rawAuthor === 'string'
          ? rawAuthor
          : rawAuthor && typeof rawAuthor === 'object' && 'name' in rawAuthor && typeof (rawAuthor as any).name === 'string'
            ? rawAuthor as { name: string, email?: string, url?: string }
            : undefined

      const maintainers: PackageInfo['maintainers'] = Array.isArray(data.maintainers)
        ? data.maintainers
          .filter((m): m is { name: string, email?: string } =>
            !!m && typeof m === 'object' && 'name' in m && typeof (m as any).name === 'string',
          )
        : undefined

      return {
        name: packageName,
        description: data.description,
        homepage: data.homepage,
        repository,
        license: data.license,
        author,
        keywords: data.keywords,
        weeklyDownloads,
        lastPublish: latest ? data.time?.[latest] : undefined,
        maintainers,
      }
    }
    catch (error) {
      console.warn(`⚠️ Failed to fetch npm info for ${packageName}:`, error)
      return {
        name: packageName,
        description: `NPM package ${packageName}`,
        homepage: `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`,
      }
    }
  }

  /**
   * Parse GitHub repository URL
   */
  private parseGitHubUrl(repositoryUrl: string): { owner: string, repo: string } | null {
    try {
      // Handle different URL formats
      const cleanUrl = repositoryUrl
        .replace(/^git\+/, '')
        .replace(/\.git$/, '')
        .replace(/^git:\/\//, 'https://')
        .replace(/^ssh:\/\/git@/, 'https://')
        .replace(/^git@github\.com:/, 'https://github.com/')

      const url = new URL(cleanUrl)

      if (url.hostname !== 'github.com') {
        return null
      }

      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length >= 2) {
        return {
          owner: pathParts[0],
          repo: pathParts[1],
        }
      }

      return null
    }
    catch {
      return null
    }
  }

  /**
   * Fetch GitHub releases between versions
   */
  private async fetchGitHubReleases(
    owner: string,
    repo: string,
    currentVersion: string,
    newVersion: string,
  ): Promise<ReleaseNote[]> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=50`,
        { headers: { 'User-Agent': this.userAgent } },
      )

      if (!response.ok) {
        return []
      }

      const releases = await response.json() as GitHubReleaseResponse[]

      // Filter releases between current and new version
      return releases
        .filter((release) => {
          const releaseVersion = release.tag_name.replace(/^v/, '')
          return this.isVersionBetween(releaseVersion, currentVersion, newVersion)
        })
        .map(release => ({
          version: release.tag_name,
          date: release.published_at,
          title: release.name ?? release.tag_name,
          body: release.body ?? '',
          htmlUrl: release.html_url,
          compareUrl: this.generateCompareUrl(owner, repo, currentVersion, release.tag_name),
          author: release.author?.login,
          isPrerelease: release.prerelease,
          assets: release.assets?.map(asset => ({
            name: asset.name,
            downloadUrl: asset.browser_download_url,
            size: asset.size,
            contentType: asset.content_type,
          })) ?? [],
        }))
    }
    catch (error) {
      console.warn(`Failed to fetch GitHub releases for ${owner}/${repo}:`, error)
      return []
    }
  }

  /**
   * Fetch changelog from repository
   */
  private async fetchChangelog(owner: string, repo: string): Promise<ChangelogEntry[]> {
    // Try common changelog file names
    const changelogFiles = ['CHANGELOG.md', 'CHANGELOG.rst', 'HISTORY.md', 'RELEASES.md']

    for (const filename of changelogFiles) {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`,
          { headers: { 'User-Agent': this.userAgent } },
        )

        if (response.ok) {
          const data = await response.json() as GitHubContentsResponse
          if (data.content) {
            const content = atob(data.content)
            return this.parseChangelog(content)
          }
        }
      }
      catch {
        // Continue to next file
      }
    }

    return []
  }

  /**
   * Parse changelog content (basic markdown parsing)
   */
  private parseChangelog(content: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = []
    const lines = content.split('\n')

    let currentEntry: Partial<ChangelogEntry> | null = null
    let currentSection: string | null = null

    for (const line of lines) {
      // Version headers (## [1.0.0] - 2023-01-01)
      const versionMatch = line.match(/^##\s*\[?([^\]]+)\]?\s*-?\s*(.*)/)
      if (versionMatch) {
        if (currentEntry) {
          entries.push(currentEntry as ChangelogEntry)
        }
        currentEntry = {
          version: versionMatch[1],
          date: versionMatch[2].trim(),
          changes: {},
        }
        currentSection = null
        continue
      }

      // Section headers (### Added, ### Fixed, etc.)
      const sectionMatch = line.match(/^###\s*(.+)/)
      if (sectionMatch && currentEntry) {
        currentSection = sectionMatch[1].toLowerCase()
        continue
      }

      // List items
      const itemMatch = line.match(/^[-*]\s*(.+)/)
      if (itemMatch && currentEntry && currentSection) {
        if (!currentEntry.changes)
          currentEntry.changes = {}
        const sectionKey = currentSection as keyof typeof currentEntry.changes
        if (!currentEntry.changes[sectionKey]) {
          currentEntry.changes[sectionKey] = []
        }
        currentEntry.changes[sectionKey]!.push(itemMatch[1])
      }
    }

    if (currentEntry) {
      entries.push(currentEntry as ChangelogEntry)
    }

    return entries.slice(0, 10) // Limit to recent entries
  }

  /**
   * Generate compare URL between versions
   */
  private generateCompareUrl(owner: string, repo: string, fromVersion: string, toVersion: string): string {
    const cleanFrom = fromVersion.startsWith('v') ? fromVersion : `v${fromVersion}`
    const cleanTo = toVersion.startsWith('v') ? toVersion : `v${toVersion}`
    return `https://github.com/${owner}/${repo}/compare/${cleanFrom}...${cleanTo}`
  }

  /**
   * Check if version is between current and new version
   */
  private isVersionBetween(version: string, current: string, target: string): boolean {
    const cleanVersion = version.replace(/^v/, '')
    const cleanCurrent = current.replace(/^v/, '')
    const cleanTarget = target.replace(/^v/, '')

    // Proper semver compare — lexicographic ordering gets `1.10.0 > 1.9.0` wrong.
    // Fall back to string equality if either side isn't valid semver.
    try {
      return cleanVersion === cleanTarget || semver.order(cleanVersion, cleanCurrent) > 0
    }
    catch {
      return cleanVersion === cleanTarget || cleanVersion > cleanCurrent
    }
  }

  /**
   * Generate confidence badges and metrics
   */
  generatePackageBadges(packageInfo: PackageInfo, currentVersion: string, newVersion: string): {
    age: string
    adoption: string
    passing: string
    confidence: string
  } {
    const packageName = encodeURIComponent(packageInfo.name)

    // Normalize versions: remove v prefix and ensure proper semver format
    const normalizedCurrent = this.normalizeVersionForBadges(currentVersion)
    const normalizedNew = this.normalizeVersionForBadges(newVersion)

    const encodedCurrent = encodeURIComponent(normalizedCurrent)
    const encodedNew = encodeURIComponent(normalizedNew)

    return {
      age: `[![age](https://developer.mend.io/api/mc/badges/age/npm/${packageName}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      adoption: `[![adoption](https://developer.mend.io/api/mc/badges/adoption/npm/${packageName}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      passing: `[![passing](https://developer.mend.io/api/mc/badges/compatibility/npm/${packageName}/${encodedCurrent}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      confidence: `[![confidence](https://developer.mend.io/api/mc/badges/confidence/npm/${packageName}/${encodedCurrent}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
    }
  }

  /**
   * Fetch Composer package information from Packagist
   */
  async fetchComposerPackageInfo(packageName: string): Promise<PackageInfo> {
    // Return mock data in test mode to avoid network calls
    if (process.env.APP_ENV === 'test') {
      return {
        name: packageName,
        description: `PHP package ${packageName} description`,
        homepage: `https://packagist.org/packages/${packageName}`,
        repository: { type: 'git', url: `https://github.com/example/${packageName}` },
        license: 'MIT',
      }
    }

    try {
      const response = await fetch(`https://packagist.org/packages/${encodeURIComponent(packageName)}.json`, {
        headers: { 'User-Agent': this.userAgent },
      })

      if (!response.ok) {
        throw new Error(`Packagist responded with ${response.status}`)
      }

      const data = await response.json() as PackagistServiceResponse
      const packageData = data.package

      if (!packageData?.versions) {
        return { name: packageName }
      }

      // Get the latest stable version info
      const versions = Object.keys(packageData.versions)
      const latestVersion = versions.find(v => !v.includes('dev') && !v.includes('alpha') && !v.includes('beta')) ?? versions[0]
      const versionData: PackagistServiceVersion = (latestVersion ? packageData.versions[latestVersion] : undefined) ?? {}
      const license = Array.isArray(versionData.license) ? versionData.license[0] : versionData.license

      const firstAuthor = versionData.authors?.[0]
      const author: PackageInfo['author']
        = firstAuthor && typeof firstAuthor === 'object' && 'name' in firstAuthor && typeof (firstAuthor as any).name === 'string'
          ? firstAuthor as { name: string, email?: string, url?: string }
          : undefined

      return {
        name: packageData.name ?? packageName,
        description: versionData.description,
        homepage: versionData.homepage,
        repository: versionData.source?.url ? { type: 'git', url: versionData.source.url } : undefined,
        license,
        author,
        keywords: versionData.keywords,
        // Packagist doesn't provide download stats like npm, so we'll skip weeklyDownloads
        lastPublish: versionData.time,
      }
    }
    catch (error) {
      console.warn(`Failed to fetch Packagist info for ${packageName}:`, error)
      return { name: packageName }
    }
  }

  /**
   * Generate Composer-specific confidence badges and metrics
   */
  generateComposerBadges(packageInfo: PackageInfo, currentVersion: string, newVersion: string): {
    age: string
    adoption: string
    passing: string
    confidence: string
  } {
    const packageName = encodeURIComponent(packageInfo.name)

    // Normalize versions: remove v prefix and ensure proper semver format
    const normalizedCurrent = this.normalizeVersionForBadges(currentVersion)
    const normalizedNew = this.normalizeVersionForBadges(newVersion)

    const encodedCurrent = encodeURIComponent(normalizedCurrent)
    const encodedNew = encodeURIComponent(normalizedNew)

    return {
      age: `[![age](https://developer.mend.io/api/mc/badges/age/packagist/${packageName}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      adoption: `[![adoption](https://developer.mend.io/api/mc/badges/adoption/packagist/${packageName}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      passing: `[![passing](https://developer.mend.io/api/mc/badges/compatibility/packagist/${packageName}/${encodedCurrent}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      confidence: `[![confidence](https://developer.mend.io/api/mc/badges/confidence/packagist/${packageName}/${encodedCurrent}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
    }
  }

  /**
   * Normalize version for badge URLs (remove v prefix, ensure proper format)
   */
  private normalizeVersionForBadges(version: string): string {
    // Remove v prefix
    let normalized = version.replace(/^v/, '')

    // If version is just major.minor (e.g., "3.0"), add .0 to make it "3.0.0"
    const parts = normalized.split('.')
    if (parts.length === 2) {
      normalized = `${normalized}.0`
    }

    return normalized
  }
}
