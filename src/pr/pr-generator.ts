import type { UpdateGroup, PullRequest, PackageUpdate, PullRequestOptions } from '../types'
import { ReleaseNotesFetcher, type PackageInfo, type ReleaseNote } from '../services/release-notes-fetcher'

export class PullRequestGenerator {
  private releaseNotesFetcher = new ReleaseNotesFetcher()

  /**
   * Generate pull requests for update groups
   */
  async generatePullRequests(groups: UpdateGroup[]): Promise<PullRequest[]> {
    const prs: PullRequest[] = []

    for (const group of groups) {
      const title = this.generateTitle(group)
      const body = await this.generateBody(group)

      // Create PR object (placeholder for now)
      const pr: PullRequest = {
        number: 0, // Will be set by Git provider
        title,
        body,
        head: `buddy/update-${group.name.toLowerCase().replace(/\s+/g, '-')}`,
        base: 'main',
        state: 'open',
        url: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        author: 'buddy-bot',
        reviewers: [],
        labels: ['dependencies', 'automated'],
        draft: false
      }

      prs.push(pr)
    }

    return prs
  }

  /**
   * Generate PR title for an update group
   */
  generateTitle(group: UpdateGroup): string {
    if (group.updates.length === 1) {
      const update = group.updates[0]
      return `chore(deps): update dependency ${update.name} to v${update.newVersion}`
    }

    const majorCount = group.updates.filter(u => u.updateType === 'major').length
    const minorCount = group.updates.filter(u => u.updateType === 'minor').length
    const patchCount = group.updates.filter(u => u.updateType === 'patch').length

    if (majorCount > 0) {
      return `chore(deps): update ${group.updates.length} dependencies (major)`
    } else if (minorCount > 0) {
      return `chore(deps): update ${group.updates.length} dependencies (minor)`
    } else {
      return `chore(deps): update ${group.updates.length} dependencies (patch)`
    }
  }

  /**
   * Generate enhanced PR body with rich formatting, badges, and release notes
   */
  async generateBody(group: UpdateGroup): Promise<string> {
    let body = `This PR contains the following updates:\n\n`

    // Enhanced updates table with confidence badges
    body += `| Package | Change | Age | Adoption | Passing | Confidence |\n`
    body += `|---|---|---|---|---|---|\n`

    // Fetch package information for each update
    const packageInfos = new Map<string, { packageInfo: PackageInfo; releaseNotes: ReleaseNote[]; compareUrl?: string }>()

    for (const update of group.updates) {
      try {
        const result = await this.releaseNotesFetcher.fetchPackageInfo(
          update.name,
          update.currentVersion,
          update.newVersion
        )
        packageInfos.set(update.name, result)
      } catch (error) {
        console.warn(`Failed to fetch info for ${update.name}:`, error)
      }
    }

    for (const update of group.updates) {
      const packageInfo = packageInfos.get(update.name)
      const info = packageInfo?.packageInfo || { name: update.name }

      const packageName = update.name
      const packageUrl = info.homepage || `https://www.npmjs.com/package/${packageName}`
      const change = `\`${update.currentVersion}\` -> \`${update.newVersion}\``

      // Generate confidence badges
      const badges = this.releaseNotesFetcher.generatePackageBadges(info, update.currentVersion, update.newVersion)

      body += `| [${packageName}](${packageUrl}) | ${change} | ${badges.age} | ${badges.adoption} | ${badges.passing} | ${badges.confidence} |\n`
    }

    body += `\n---\n\n`

    // Enhanced release notes section
    body += `### Release Notes\n\n`
    for (const update of group.updates) {
      const packageInfo = packageInfos.get(update.name)
      const info = packageInfo?.packageInfo || { name: update.name }
      const releaseNotes = packageInfo?.releaseNotes || []
      const compareUrl = packageInfo?.compareUrl

      body += `<details>\n`
      body += `<summary>${info.repository?.url ? this.getRepositoryName(info.repository.url) : update.name} (${update.name})</summary>\n\n`

      if (releaseNotes.length > 0) {
        for (const release of releaseNotes.slice(0, 3)) { // Limit to 3 most recent releases
          body += `### [\`${release.version}\`](${release.htmlUrl})\n\n`

          if (compareUrl) {
            body += `[Compare Source](${compareUrl})\n\n`
          }

          if (release.body) {
            // Limit release body length and clean up markdown
            const cleanBody = this.cleanReleaseBody(release.body)
            body += `${cleanBody}\n\n`
          }

          if (release.author) {
            body += `*Released by [@${release.author}](https://github.com/${release.author}) on ${new Date(release.date).toLocaleDateString()}*\n\n`
          }
        }
      } else {
        body += `**${update.currentVersion} -> ${update.newVersion}**\n\n`

        if (compareUrl) {
          body += `[Compare Source](${compareUrl})\n\n`
        }

        if (info.description) {
          body += `${info.description}\n\n`
        }

        if (update.releaseNotesUrl) {
          body += `[Release Notes](${update.releaseNotesUrl})\n\n`
        }

        if (update.changelogUrl) {
          body += `[Changelog](${update.changelogUrl})\n\n`
        }
      }

      body += `</details>\n\n`
    }

    body += `---\n\n`

    // Package statistics section
    if (packageInfos.size > 0) {
      body += `### 📊 Package Statistics\n\n`
      for (const update of group.updates) {
        const packageInfo = packageInfos.get(update.name)
        const info = packageInfo?.packageInfo
        if (info?.weeklyDownloads) {
          body += `- **${update.name}**: ${info.weeklyDownloads.toLocaleString()} weekly downloads\n`
        }
      }
      body += `\n---\n\n`
    }

    // Configuration section
    body += `### Configuration\n\n`
    body += `📅 **Schedule**: Branch creation - At any time (no schedule defined), Automerge - At any time (no schedule defined).\n\n`
    body += `🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.\n\n`
    body += `♻ **Rebasing**: Whenever PR is behind base branch, or you tick the rebase/retry checkbox.\n\n`
    body += `🔕 **Ignore**: Close this PR and you won't be reminded about these updates again.\n\n`
    body += `---\n\n`
    body += ` - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box\n\n`
    body += `---\n\n`
    body += `This PR was generated by [Buddy](https://github.com/stacksjs/buddy) 🤖`

    return body
  }

  /**
   * Extract repository name from GitHub URL
   */
  private getRepositoryName(repositoryUrl: string): string {
    try {
      const cleanUrl = repositoryUrl
        .replace(/^git\+/, '')
        .replace(/\.git$/, '')
        .replace(/^git:\/\//, 'https://')
        .replace(/^ssh:\/\/git@/, 'https://')
        .replace(/^git@github\.com:/, 'https://github.com/')

      const url = new URL(cleanUrl)
      const pathParts = url.pathname.split('/').filter(Boolean)

      if (pathParts.length >= 2) {
        return `${pathParts[0]}/${pathParts[1]}`
      }

      return repositoryUrl
    } catch {
      return repositoryUrl
    }
  }

  /**
   * Clean and truncate release body content
   */
  private cleanReleaseBody(body: string): string {
    // Remove excessive whitespace and limit length
    let cleaned = body
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    // Limit to reasonable length for PR body
    if (cleaned.length > 1000) {
      cleaned = cleaned.substring(0, 1000) + '...\n\n*[View full release notes]*'
    }

    return cleaned
  }

  /**
   * Generate custom PR templates
   */
  generateCustomTemplate(
    group: UpdateGroup,
    template: string,
    variables: Record<string, string> = {}
  ): string {
    let result = template

    // Default variables
    const defaultVars = {
      '{title}': this.generateTitle(group),
      '{package_count}': group.updates.length.toString(),
      '{update_type}': group.updateType,
      '{packages}': group.updates.map(u => u.name).join(', '),
      '{date}': new Date().toISOString().split('T')[0]
    }

    // Replace variables
    const allVars = { ...defaultVars, ...variables }
    for (const [key, value] of Object.entries(allVars)) {
      result = result.replace(new RegExp(key, 'g'), value)
    }

    return result
  }
}
