import type { PackageInfo, ReleaseNote } from '../services/release-notes-fetcher'
import type { PullRequest, UpdateGroup } from '../types'
import { ReleaseNotesFetcher } from '../services/release-notes-fetcher'

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
        assignees: [],
        labels: ['dependencies', 'automated'],
        draft: false,
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
    // const _patchCount = group.updates.filter(u => u.updateType === 'patch').length

    if (majorCount > 0) {
      return `chore(deps): update ${group.updates.length} dependencies (major)`
    }
    else if (minorCount > 0) {
      return `chore(deps): update ${group.updates.length} dependencies (minor)`
    }
    else {
      return `chore(deps): update ${group.updates.length} dependencies (patch)`
    }
  }

  /**
   * Generate enhanced PR body with rich formatting, badges, and release notes
   */
  async generateBody(group: UpdateGroup): Promise<string> {
    let body = `This PR contains the following updates:\n\n`

    // Separate updates by type
    const packageJsonUpdates = group.updates.filter(update =>
      update.file === 'package.json',
    )
    const composerUpdates = group.updates.filter(update =>
      update.file.endsWith('composer.json') || update.file.endsWith('composer.lock'),
    )
    const dependencyFileUpdates = group.updates.filter(update =>
      update.file.includes('.yaml') || update.file.includes('.yml'),
    ).filter(update => !update.file.includes('.github/workflows/'))
    const githubActionsUpdates = group.updates.filter(update =>
      update.file.includes('.github/workflows/'),
    )

    // Deduplicate GitHub Actions updates by name (multiple files may reference same action)
    const uniqueGithubActionsUpdates = githubActionsUpdates.reduce((acc, update) => {
      const existing = acc.find(u => u.name === update.name && u.currentVersion === update.currentVersion && u.newVersion === update.newVersion)
      if (!existing) {
        // Create consolidated update with unique files only
        const allFilesForAction = [...new Set(githubActionsUpdates
          .filter(u => u.name === update.name && u.currentVersion === update.currentVersion && u.newVersion === update.newVersion)
          .map(u => u.file))]
        acc.push({
          ...update,
          file: allFilesForAction.join(', '), // Combine all unique affected files
        })
      }
      return acc
    }, [] as typeof githubActionsUpdates)

    // Fetch package information for package.json updates only
    const packageInfos = new Map<string, { packageInfo: PackageInfo, releaseNotes: ReleaseNote[], compareUrl?: string }>()

    // Package.json updates table (with full badges)
    if (packageJsonUpdates.length > 0) {
      body += `### npm Dependencies\n\n`
      body += `| Package | Change | Age | Adoption | Passing | Confidence |\n`
      body += `|---|---|---|---|---|---|\n`

      for (const update of packageJsonUpdates) {
        try {
          // Clean package name (remove dependency type info) before fetching
          const cleanPackageName = update.name.replace(/\s*\(dev\)$/, '').replace(/\s*\(peer\)$/, '').replace(/\s*\(optional\)$/, '')

          const result = await this.releaseNotesFetcher.fetchPackageInfo(
            cleanPackageName,
            update.currentVersion,
            update.newVersion,
          )
          packageInfos.set(update.name, result)
        }
        catch (error) {
          console.warn(`Failed to fetch info for ${update.name}:`, error)
        }
      }

      for (const update of packageJsonUpdates) {
        const packageInfo = packageInfos.get(update.name)
        const info = packageInfo?.packageInfo || { name: update.name }

        // Clean package name (remove dependency type info)
        const cleanPackageName = update.name.replace(/\s*\(dev\)$/, '').replace(/\s*\(peer\)$/, '').replace(/\s*\(optional\)$/, '')

        // Generate package URL with source link (Renovate style)
        let packageCell: string
        if (info.repository?.url) {
          const repoUrl = this.getRepositorySourceUrl(info.repository.url, cleanPackageName)
          const sourceUrl = this.getRepositorySourceUrl(info.repository.url, cleanPackageName, 'HEAD')
          packageCell = `[${cleanPackageName}](${repoUrl}) ([source](${sourceUrl}))`
        }
        else if (cleanPackageName.startsWith('@types/')) {
          // Special handling for @types/* packages even without repository metadata
          const typeName = cleanPackageName.replace('@types/', '')
          const repoUrl = `https://redirect.github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/${typeName}`
          const sourceUrl = `https://redirect.github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/${typeName}`
          packageCell = `[${cleanPackageName}](${repoUrl}) ([source](${sourceUrl}))`
        }
        else {
          // Fallback to npm page if no repository
          packageCell = `[${cleanPackageName}](https://www.npmjs.com/package/${encodeURIComponent(cleanPackageName)})`
        }

        // Generate version change with diff link (Renovate style)
        const diffUrl = `https://renovatebot.com/diffs/npm/${encodeURIComponent(cleanPackageName)}/${update.currentVersion}/${update.newVersion}`
        const change = `[\`${update.currentVersion}\` -> \`${update.newVersion}\`](${diffUrl})`

        // Generate confidence badges with clean package name
        const badges = this.releaseNotesFetcher.generatePackageBadges(
          { ...info, name: cleanPackageName },
          update.currentVersion,
          update.newVersion,
        )

        body += `| ${packageCell} | ${change} | ${badges.age} | ${badges.adoption} | ${badges.passing} | ${badges.confidence} |\n`
      }

      body += `\n`
    }

    // Composer dependencies table (simplified, without badges)
    if (composerUpdates.length > 0) {
      body += `### PHP/Composer Dependencies\n\n`
      body += `| Package | Change | File | Status |\n`
      body += `|---|---|---|---|\n`

      for (const update of composerUpdates) {
        // Generate package link
        const packageUrl = `https://packagist.org/packages/${encodeURIComponent(update.name)}`
        const packageCell = `[${update.name}](${packageUrl})`

        // Simple version change display
        const change = `\`${update.currentVersion}\` -> \`${update.newVersion}\``

        // File reference
        const fileName = update.file.split('/').pop() || update.file

        // Status (simple)
        const status = '✅ Available'

        body += `| ${packageCell} | ${change} | ${fileName} | ${status} |\n`
      }

      body += `\n`
    }

    // Dependency files table (simplified, without badges)
    if (dependencyFileUpdates.length > 0) {
      body += `### Launchpad/pkgx Dependencies\n\n`
      body += `| Package | Change | File | Status |\n`
      body += `|---|---|---|---|\n`

      for (const update of dependencyFileUpdates) {
        // Handle special case: bun.sh -> bun.com
        const displayName = update.name === 'bun.sh' ? 'bun.com' : update.name

        // Generate package link
        const packageUrl = update.name === 'bun.sh'
          ? 'https://bun.sh'
          : `https://pkgx.com/pkg/${encodeURIComponent(update.name)}`
        const packageCell = `[${displayName}](${packageUrl})`

        // Simple version change display
        const change = `\`${update.currentVersion}\` -> \`${update.newVersion}\``

        // File reference
        const fileName = update.file.split('/').pop() || update.file

        // Status (simple)
        const status = '✅ Available'

        body += `| ${packageCell} | ${change} | ${fileName} | ${status} |\n`
      }

      body += `\n`
    }

    // Composer dependencies table (simplified, without badges)
    if (composerUpdates.length > 0) {
      body += `### PHP/Composer Dependencies\n\n`
      body += `| Package | Change | File | Status |\n`
      body += `|---|---|---|---|\n`

      for (const update of composerUpdates) {
        // Generate package link
        const packageUrl = `https://packagist.org/packages/${encodeURIComponent(update.name)}`
        const packageCell = `[${update.name}](${packageUrl})`

        // Simple version change display
        const change = `\`${update.currentVersion}\` -> \`${update.newVersion}\``

        // File reference
        const fileName = update.file.split('/').pop() || update.file

        // Status (simple)
        const status = '✅ Available'

        body += `| ${packageCell} | ${change} | ${fileName} | ${status} |\n`
      }

      body += `\n`
    }

    // GitHub Actions table (simplified, without badges, deduplicated)
    if (uniqueGithubActionsUpdates.length > 0) {
      body += `### GitHub Actions\n\n`
      body += `| Action | Change | File | Status |\n`
      body += `|---|---|---|---|\n`

      for (const update of uniqueGithubActionsUpdates) {
        // Generate action link
        const actionUrl = `https://github.com/${update.name}`
        const actionCell = `[${update.name}](${actionUrl})`

        // Simple version change display
        const change = `\`${update.currentVersion}\` -> \`${update.newVersion}\``

        // File reference with GitHub links (may be multiple files now)
        const fileLinks = update.file.includes(', ')
          ? update.file.split(', ').map((f) => {
              const fileName = f.split('/').pop() || f
              return `[${fileName}](../${f})`
            }).join(', ')
          : (() => {
              const fileName = update.file.split('/').pop() || update.file
              return `[${fileName}](../${update.file})`
            })()

        // Status (simple)
        const status = '✅ Available'

        body += `| ${actionCell} | ${change} | ${fileLinks} | ${status} |\n`
      }

      body += `\n`
    }

    body += `\n---\n\n`

    // Enhanced release notes section
    body += `### Release Notes\n\n`

    // Process package.json updates with full release notes
    for (const update of packageJsonUpdates) {
      const packageInfo = packageInfos.get(update.name)
      const info = packageInfo?.packageInfo || { name: update.name }
      const releaseNotes = packageInfo?.releaseNotes || []
      const compareUrl = packageInfo?.compareUrl

      body += `<details>\n`

      // Generate summary title following Renovate's format
      let summaryTitle: string

      // Clean package name (remove dependency type info like "(dev)")
      const cleanPackageName = update.name.replace(/\s*\(dev\)$/, '').replace(/\s*\(peer\)$/, '').replace(/\s*\(optional\)$/, '')

      if (info.repository?.url) {
        const repoName = this.getRepositoryName(info.repository.url)
        // Always show in format "owner/repo (package)" to match Renovate
        summaryTitle = `${repoName} (${cleanPackageName})`
      }
      else {
        // No repository info, just use the clean package name
        summaryTitle = cleanPackageName
      }

      body += `<summary>${summaryTitle}</summary>\n\n`

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
      }
      else {
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

    // Process dependency file updates with simple release notes (no duplicates with package.json)
    const dependencyOnlyUpdates = dependencyFileUpdates.filter(depUpdate =>
      !packageJsonUpdates.some(pkgUpdate =>
        pkgUpdate.name.replace(/\s*\(dev\)$/, '').replace(/\s*\(peer\)$/, '').replace(/\s*\(optional\)$/, '') === depUpdate.name,
      ),
    )

    for (const update of dependencyOnlyUpdates) {
      // Handle special case: bun.sh -> bun.com
      const displayName = update.name === 'bun.sh' ? 'bun.com' : update.name

      body += `<details>\n`
      body += `<summary>${displayName}</summary>\n\n`
      body += `**${update.currentVersion} -> ${update.newVersion}**\n\n`

      if (update.name === 'bun.sh') {
        body += `Visit [bun.sh](https://bun.sh) for more information about Bun releases.\n\n`
      }
      else {
        body += `Visit [pkgx.com](https://pkgx.com/pkg/${encodeURIComponent(update.name)}) for more information.\n\n`
      }

      body += `</details>\n\n`
    }

    // Process Composer updates with simple release notes
    for (const update of composerUpdates) {
      body += `<details>\n`
      body += `<summary>${update.name}</summary>\n\n`
      body += `**${update.currentVersion} -> ${update.newVersion}**\n\n`
      body += `Visit [${update.name}](https://packagist.org/packages/${encodeURIComponent(update.name)}) on Packagist for more information.\n\n`
      body += `</details>\n\n`
    }

    // Process GitHub Actions updates with simple release notes (no duplicates)
    for (const update of uniqueGithubActionsUpdates) {
      body += `<details>\n`
      body += `<summary>${update.name}</summary>\n\n`
      body += `**${update.currentVersion} -> ${update.newVersion}**\n\n`
      body += `Visit [${update.name}](https://github.com/${update.name}/releases) for release notes.\n\n`
      body += `</details>\n\n`
    }

    body += `---\n\n`

    // Package statistics section (deduplicated)
    if (packageInfos.size > 0 || composerUpdates.length > 0 || dependencyOnlyUpdates.length > 0 || uniqueGithubActionsUpdates.length > 0) {
      body += `### 📊 Package Statistics\n\n`

      // Stats for package.json updates
      for (const update of packageJsonUpdates) {
        const packageInfo = packageInfos.get(update.name)
        const info = packageInfo?.packageInfo
        if (info?.weeklyDownloads) {
          body += `- **${update.name}**: ${info.weeklyDownloads.toLocaleString()} weekly downloads\n`
        }
      }

      // Stats for Composer updates (simplified)
      for (const update of composerUpdates) {
        body += `- **${update.name}**: PHP package available on Packagist\n`
      }

      // Stats for dependency file updates (simplified, only for those not in package.json)
      for (const update of dependencyOnlyUpdates) {
        const displayName = update.name === 'bun.sh' ? 'bun.com' : update.name
        if (update.name === 'bun.sh') {
          body += `- **${displayName}**: Popular JavaScript runtime and package manager\n`
        }
        else {
          body += `- **${displayName}**: Available via pkgx package manager\n`
        }
      }

      // Stats for GitHub Actions updates (simplified, deduplicated)
      for (const update of uniqueGithubActionsUpdates) {
        body += `- **${update.name}**: GitHub Action for workflow automation\n`
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
    body += ` - [ ] <!-- rebase-check -->If you want to update/retry this PR, check this box\n\n`
    body += `---\n\n`
    body += `This PR was generated by [Buddy](https://github.com/stacksjs/buddy-bot) 🤖`

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
    }
    catch {
      return repositoryUrl
    }
  }

  /**
   * Generate repository source URL for packages (Renovate style)
   */
  private getRepositorySourceUrl(repositoryUrl: string, packageName: string, ref: string = 'master'): string {
    try {
      const cleanUrl = repositoryUrl
        .replace(/^git\+/, '')
        .replace(/\.git$/, '')
        .replace(/^git:\/\//, 'https://')
        .replace(/^ssh:\/\/git@/, 'https://')
        .replace(/^git@github\.com:/, 'https://github.com/')

      const url = new URL(cleanUrl)

      // For DefinitelyTyped packages, use the types subdirectory
      if (packageName.startsWith('@types/') && url.pathname.includes('DefinitelyTyped')) {
        const typeName = packageName.replace('@types/', '')
        return `https://redirect.github.com/DefinitelyTyped/DefinitelyTyped/tree/${ref}/types/${typeName}`
      }

      // For regular GitHub repositories
      if (url.hostname === 'github.com') {
        return `${cleanUrl}/tree/${ref}`
      }

      // Fallback to repository URL
      return cleanUrl
    }
    catch {
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
      cleaned = `${cleaned.substring(0, 1000)}...\n\n*[View full release notes]*`
    }

    return cleaned
  }

  /**
   * Generate custom PR templates
   */
  generateCustomTemplate(
    group: UpdateGroup,
    template: string,
    variables: Record<string, string> = {},
  ): string {
    let result = template

    // Default variables
    const defaultVars = {
      '{title}': this.generateTitle(group),
      '{package_count}': group.updates.length.toString(),
      '{update_type}': group.updateType,
      '{packages}': group.updates.map(u => u.name).join(', '),
      '{date}': new Date().toISOString().split('T')[0],
    }

    // Replace variables
    const allVars = { ...defaultVars, ...variables }
    for (const [key, value] of Object.entries(allVars)) {
      result = result.replace(new RegExp(key, 'g'), value)
    }

    return result
  }
}
