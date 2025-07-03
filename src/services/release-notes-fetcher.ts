import type { PackageUpdate, PackageMetadata } from '../types'

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
  author?: string | { name: string; email?: string; url?: string }
  keywords?: string[]
  weeklyDownloads?: number
  lastPublish?: string
  maintainers?: Array<{ name: string; email?: string }>
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
        compareUrl
      }
    } catch (error) {
      console.warn(`Failed to fetch package info for ${packageName}:`, error)
      return {
        packageInfo: { name: packageName },
        releaseNotes: [],
        changelog: []
      }
    }
  }

  /**
   * Fetch package information from npm registry
   */
  private async fetchNpmPackageInfo(packageName: string): Promise<PackageInfo> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
        headers: { 'User-Agent': this.userAgent }
      })

      if (!response.ok) {
        throw new Error(`NPM registry responded with ${response.status}`)
      }

            const data = await response.json() as any
      const latest = data['dist-tags']?.latest
      const latestVersion = latest ? data.versions[latest] : null

      // Fetch weekly downloads
      let weeklyDownloads: number | undefined
      try {
        const downloadsResponse = await fetch(
          `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`,
          { headers: { 'User-Agent': this.userAgent } }
        )
        if (downloadsResponse.ok) {
          const downloadsData = await downloadsResponse.json() as any
          weeklyDownloads = downloadsData.downloads
        }
      } catch {
        // Ignore download fetch errors
      }

      return {
        name: packageName,
        description: data.description,
        homepage: data.homepage,
        repository: data.repository,
        license: data.license,
        author: data.author,
        keywords: data.keywords,
        weeklyDownloads,
        lastPublish: data.time?.[latest],
        maintainers: data.maintainers
      }
    } catch (error) {
      console.warn(`Failed to fetch npm info for ${packageName}:`, error)
      return { name: packageName }
    }
  }

  /**
   * Parse GitHub repository URL
   */
  private parseGitHubUrl(repositoryUrl: string): { owner: string; repo: string } | null {
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
          repo: pathParts[1]
        }
      }

      return null
    } catch {
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
    newVersion: string
  ): Promise<ReleaseNote[]> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=50`,
        { headers: { 'User-Agent': this.userAgent } }
      )

      if (!response.ok) {
        return []
      }

      const releases = await response.json() as any[]

      // Filter releases between current and new version
      return releases
        .filter((release: any) => {
          const releaseVersion = release.tag_name.replace(/^v/, '')
          return this.isVersionBetween(releaseVersion, currentVersion, newVersion)
        })
        .map((release: any) => ({
          version: release.tag_name,
          date: release.published_at,
          title: release.name || release.tag_name,
          body: release.body || '',
          htmlUrl: release.html_url,
          compareUrl: this.generateCompareUrl(owner, repo, currentVersion, release.tag_name),
          author: release.author?.login,
          isPrerelease: release.prerelease,
          assets: release.assets?.map((asset: any) => ({
            name: asset.name,
            downloadUrl: asset.browser_download_url,
            size: asset.size,
            contentType: asset.content_type
          })) || []
        }))
    } catch (error) {
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
          { headers: { 'User-Agent': this.userAgent } }
        )

        if (response.ok) {
          const data = await response.json() as any
          if (data.content) {
            const content = atob(data.content)
            return this.parseChangelog(content)
          }
        }
      } catch {
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
          changes: {}
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
        if (!currentEntry.changes) currentEntry.changes = {}
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
    // This is a simplified version comparison
    // In production, you'd want to use a proper semver library
    const cleanVersion = version.replace(/^v/, '')
    const cleanCurrent = current.replace(/^v/, '')
    const cleanTarget = target.replace(/^v/, '')

    // For now, just check if version equals target or is "newer" than current
    return cleanVersion === cleanTarget || cleanVersion > cleanCurrent
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
    const encodedCurrent = encodeURIComponent(currentVersion)
    const encodedNew = encodeURIComponent(newVersion)

    return {
      age: `[![age](https://developer.mend.io/api/mc/badges/age/npm/${packageName}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      adoption: `[![adoption](https://developer.mend.io/api/mc/badges/adoption/npm/${packageName}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      passing: `[![passing](https://developer.mend.io/api/mc/badges/compatibility/npm/${packageName}/${encodedCurrent}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`,
      confidence: `[![confidence](https://developer.mend.io/api/mc/badges/confidence/npm/${packageName}/${encodedCurrent}/${encodedNew}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`
    }
  }
}
