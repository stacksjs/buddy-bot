import type { PackageInfo, ReleaseNote } from '../services/release-notes-fetcher'
import type { BuddyBotConfig, PullRequest, UpdateGroup } from '../types'
import { ReleaseNotesFetcher } from '../services/release-notes-fetcher'

export class PullRequestGenerator {
  private releaseNotesFetcher = new ReleaseNotesFetcher()

  constructor(private readonly config?: BuddyBotConfig | undefined) {}

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
        author: 'github-actions[bot]',
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
    // Count different types of updates
    const packageJsonCount = group.updates.filter(u => u.file === 'package.json').length
    const dependencyFileCount = group.updates.filter(u =>
      (u.file.includes('.yaml') || u.file.includes('.yml')) && !u.file.includes('.github/workflows/'),
    ).length
    const githubActionsCount = group.updates.filter(u => u.file.includes('.github/workflows/')).length
    const composerCount = group.updates.filter(u =>
      u.file.endsWith('composer.json') || u.file.endsWith('composer.lock'),
    ).length

    let body = `This PR contains the following updates:\n\n`

    // Add summary table (always show for clarity)
    body += `## Package Updates Summary\n\n`
    body += `| Type | Count |\n`
    body += `|------|-------|\n`
    if (packageJsonCount > 0)
      body += `| 📦 NPM Packages | ${packageJsonCount} |\n`
    if (dependencyFileCount > 0)
      body += `| 🔧 System Dependencies | ${dependencyFileCount} |\n`
    if (githubActionsCount > 0)
      body += `| 🚀 GitHub Actions | ${githubActionsCount} |\n`
    if (composerCount > 0)
      body += `| 🎼 Composer Packages | ${composerCount} |\n`
    body += `| **Total** | **${group.updates.length}** |\n\n`

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

    // Deduplicate Composer updates by name and version (similar to GitHub Actions)
    const uniqueComposerUpdates = composerUpdates.reduce((acc, update) => {
      const existing = acc.find(u => u.name === update.name && u.currentVersion === update.currentVersion && u.newVersion === update.newVersion)
      if (!existing) {
        acc.push(update)
      }
      return acc
    }, [] as typeof composerUpdates)

    // Fetch package information for package.json updates only
    const packageInfos = new Map<string, { packageInfo: PackageInfo, releaseNotes: ReleaseNote[], compareUrl?: string }>()

    // Fetch Composer package information
    const composerPackageInfos = new Map<string, PackageInfo>()

    // Package.json updates table (with full badges)
    if (packageJsonUpdates.length > 0) {
      body += `## 📦 npm Dependencies\n\n`
      if (packageJsonUpdates.length === 1) {
        body += `*${packageJsonUpdates.length} package will be updated*\n\n`
      }
      else if (packageJsonUpdates.length > 1) {
        body += `*${packageJsonUpdates.length} packages will be updated*\n\n`
      }
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

    // Composer dependencies table (with full badges like npm)
    if (uniqueComposerUpdates.length > 0) {
      // Fetch Composer package information first
      for (const update of uniqueComposerUpdates) {
        try {
          const packageInfo = await this.releaseNotesFetcher.fetchComposerPackageInfo(update.name)
          composerPackageInfos.set(update.name, packageInfo)
        }
        catch (error) {
          console.warn(`Failed to fetch Composer info for ${update.name}:`, error)
        }
      }

      body += `## 🐘 PHP/Composer Dependencies\n\n`
      if (uniqueComposerUpdates.length === 1) {
        body += `*${uniqueComposerUpdates.length} package will be updated*\n\n`
      }
      else if (uniqueComposerUpdates.length > 1) {
        body += `*${uniqueComposerUpdates.length} packages will be updated*\n\n`
      }
      body += `| Package | Change | Age | Adoption | Passing | Confidence | Type | Update |\n`
      body += `|---|---|---|---|---|---|---|---|\n`

      for (const update of uniqueComposerUpdates) {
        const packageInfo = composerPackageInfos.get(update.name) || { name: update.name }

        // Generate package link: homepage first, then source
        let packageCell: string
        if (packageInfo.homepage && packageInfo.repository?.url) {
          const sourceUrl = this.getComposerRedirectSourceUrl(packageInfo.repository.url, update.name)
          packageCell = `[${update.name}](${packageInfo.homepage}) ([source](${sourceUrl}))`
        }
        else if (packageInfo.repository?.url) {
          const sourceUrl = this.getComposerRedirectSourceUrl(packageInfo.repository.url, update.name)
          packageCell = `[${update.name}](${sourceUrl})`
        }
        else {
          // Fallback to Packagist page
          packageCell = `[${update.name}](https://packagist.org/packages/${encodeURIComponent(update.name)})`
        }

        // Generate constraint-style version change (e.g., ^3.0 -> ^3.10.0)
        const constraintChange = this.getConstraintStyleChange(update.currentVersion, update.newVersion)
        const diffUrl = `https://renovatebot.com/diffs/packagist/${encodeURIComponent(update.name)}/${update.currentVersion}/${update.newVersion}`
        const change = `[\`${constraintChange}\`](${diffUrl})`

        // Generate Composer confidence badges
        const badges = this.releaseNotesFetcher.generateComposerBadges(
          packageInfo,
          update.currentVersion,
          update.newVersion,
        )

        // Dependency type and update type
        const dependencyType = update.dependencyType || 'require'
        const updateType = update.updateType || 'minor'

        body += `| ${packageCell} | ${change} | ${badges.age} | ${badges.adoption} | ${badges.passing} | ${badges.confidence} | ${dependencyType} | ${updateType} |\n`
      }

      body += `\n`
    }

    // Dependency files table (enhanced with more information)
    if (dependencyFileUpdates.length > 0) {
      body += `## 🔧 System Dependencies\n\n`

      const uniqueFiles = [...new Set(dependencyFileUpdates.map(u => u.file))]
      if (dependencyFileUpdates.length === 1) {
        body += `*${dependencyFileUpdates.length} package will be updated in \`${uniqueFiles[0].split('/').pop()}\`*\n\n`
      }
      else if (dependencyFileUpdates.length > 1) {
        body += `*${dependencyFileUpdates.length} packages will be updated across ${uniqueFiles.length} file(s): ${uniqueFiles.map(f => `\`${f.split('/').pop()}\``).join(', ')}*\n\n`
      }

      body += `| Package | Change | Type | File | Links |\n`
      body += `|---|---|---|---|---|\n`

      for (const update of dependencyFileUpdates) {
        // Handle special case: bun.sh -> bun.com
        const displayName = update.name === 'bun.sh' ? 'bun.com' : update.name

        // Generate package link
        const packageUrl = update.name === 'bun.sh'
          ? 'https://bun.sh'
          : `https://pkgx.com/pkg/${encodeURIComponent(update.name)}`
        const packageCell = `[${displayName}](${packageUrl})`

        // Enhanced version change display with update type
        const updateType = this.getUpdateType(update.currentVersion, update.newVersion)
        const typeEmoji = updateType === 'major' ? '🔴' : updateType === 'minor' ? '🟡' : '🟢'
        const change = `\`${update.currentVersion}\` → \`${update.newVersion}\``

        // File reference with link to actual file
        const fileName = update.file.split('/').pop() || update.file
        const fileCell = this.config?.repository?.owner && this.config?.repository?.name
          ? `[\`${fileName}\`](https://github.com/${this.config.repository.owner}/${this.config.repository.name}/blob/main/${update.file})`
          : `\`${fileName}\``

        // Enhanced links column
        let linksCell = `📦 [pkgx](${packageUrl})`
        if (update.name.includes('.org') || update.name.includes('.net') || update.name.includes('.com')) {
          const domain = update.name.split('/')[0] || update.name
          linksCell += ` | 🌐 [${domain}](https://${domain})`
        }

        body += `| ${packageCell} | ${change} | ${typeEmoji} ${updateType} | ${fileCell} | ${linksCell} |\n`
      }

      body += `\n`
    }

    // GitHub Actions table (enhanced with more information)
    if (uniqueGithubActionsUpdates.length > 0) {
      body += `## 🚀 GitHub Actions\n\n`

      if (uniqueGithubActionsUpdates.length === 1) {
        body += `*${uniqueGithubActionsUpdates.length} action will be updated*\n\n`
      }
      else if (uniqueGithubActionsUpdates.length > 1) {
        body += `*${uniqueGithubActionsUpdates.length} actions will be updated*\n\n`
      }

      body += `| Action | Change | Type | Files | Links |\n`
      body += `|---|---|---|---|---|\n`

      for (const update of uniqueGithubActionsUpdates) {
        // Generate action link
        const actionUrl = `https://github.com/${update.name}`
        const actionCell = `[${update.name}](${actionUrl})`

        // Enhanced version change display with update type
        const updateType = this.getUpdateType(update.currentVersion, update.newVersion)
        const typeEmoji = updateType === 'major' ? '🔴' : updateType === 'minor' ? '🟡' : '🟢'
        const change = `\`${update.currentVersion}\` → \`${update.newVersion}\``

        // Enhanced file reference with proper GitHub links
        const fileLinks = update.file.includes(', ')
          ? update.file.split(', ').map((f) => {
              const fileName = f.split('/').pop() || f
              return this.config?.repository?.owner && this.config?.repository?.name
                ? `[\`${fileName}\`](https://github.com/${this.config.repository.owner}/${this.config.repository.name}/blob/main/${f})`
                : `\`${fileName}\``
            }).join(', ')
          : (() => {
              const fileName = update.file.split('/').pop() || update.file
              return this.config?.repository?.owner && this.config?.repository?.name
                ? `[\`${fileName}\`](https://github.com/${this.config.repository.owner}/${this.config.repository.name}/blob/main/${update.file})`
                : `\`${fileName}\``
            })()

        // Enhanced links column
        const releasesUrl = `https://github.com/${update.name}/releases`
        const compareUrl = `https://github.com/${update.name}/compare/${update.currentVersion}...${update.newVersion}`
        const linksCell = `📋 [releases](${releasesUrl}) | 📊 [compare](${compareUrl})`

        body += `| ${actionCell} | ${change} | ${typeEmoji} ${updateType} | ${fileLinks} | ${linksCell} |\n`
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

      // Always show version change information
      body += `**${update.currentVersion} -> ${update.newVersion}**\n\n`

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
        // Fallback content when release notes aren't available
        if (compareUrl) {
          body += `[Compare Source](${compareUrl})\n\n`
        }

        if (info.description) {
          body += `${info.description}\n\n`
        }

        // Generate release notes links based on repository
        if (info.repository?.url) {
          const repoName = this.getRepositoryName(info.repository.url)
          if (repoName) {
            body += `📖 [View Release Notes](https://github.com/${repoName}/releases)\n\n`
            body += `🔗 [View Changelog](https://github.com/${repoName}/blob/main/CHANGELOG.md)\n\n`
          }
        }
        else {
          // Fallback to npm page
          body += `📦 [View on npm](https://www.npmjs.com/package/${encodeURIComponent(cleanPackageName)})\n\n`
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

    // Process dependency file updates with enhanced release notes and file links
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

      // Add file reference with link to the dependency file
      if (update.file) {
        const fileName = update.file.split('/').pop() || update.file
        const fileCell = this.config?.repository?.owner && this.config?.repository?.name
          ? `📁 **File**: [\`${fileName}\`](https://github.com/${this.config.repository.owner}/${this.config.repository.name}/blob/main/${update.file})\n\n`
          : `📁 **File**: \`${fileName}\`\n\n`
        body += fileCell
      }

      // Add appropriate links based on package type
      if (update.name === 'bun.sh') {
        body += `🔗 **Release Notes**: [bun.sh](https://bun.sh)\n\n`
      }
      else if (update.name.includes('.org') || update.name.includes('.net') || update.name.includes('.com')) {
        // For domain-style packages, link to pkgx and try to provide the official site
        const domain = update.name.split('/')[0] || update.name
        body += `🔗 **Package Info**: [pkgx.com](https://pkgx.com/pkg/${encodeURIComponent(update.name)})\n\n`
        body += `🌐 **Official Site**: [${domain}](https://${domain})\n\n`
      }
      else {
        body += `🔗 **Package Info**: [pkgx.com](https://pkgx.com/pkg/${encodeURIComponent(update.name)})\n\n`
      }

      body += `</details>\n\n`
    }

    // Process Composer updates with simple release notes
    for (const update of uniqueComposerUpdates) {
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
    if (packageInfos.size > 0 || uniqueComposerUpdates.length > 0 || dependencyOnlyUpdates.length > 0 || uniqueGithubActionsUpdates.length > 0) {
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
      for (const update of uniqueComposerUpdates) {
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
    const ignoreText = group.updates.length === 1 ? 'this update again' : 'these updates again'
    body += `🔕 **Ignore**: Close this PR and you won't be reminded about ${ignoreText}.\n\n`
    body += `---\n\n`
    body += ` - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box\n\n`
    body += `---\n\n`
    body += `This PR was generated by [Buddy](https://github.com/stacksjs/buddy-bot) 🤖`

    // Ensure PR body doesn't exceed GitHub's 65,536 character limit
    const MAX_BODY_LENGTH = 60000 // Leave some buffer
    if (body.length > MAX_BODY_LENGTH) {
      const truncatedBody = body.substring(0, MAX_BODY_LENGTH)
      const lastDetailsEnd = truncatedBody.lastIndexOf('</details>')
      if (lastDetailsEnd > 0) {
        // Truncate at the last complete details section
        body = `${truncatedBody.substring(0, lastDetailsEnd + 10)}\n\n---\n\n**Note**: This PR body was truncated due to GitHub's character limit. View the full details in the individual commits.\n\n`
      }
      else {
        body = `${truncatedBody}\n\n---\n\n**Note**: This PR body was truncated due to GitHub's character limit.\n\n`
      }
      body += `This PR was generated by [Buddy](https://github.com/stacksjs/buddy-bot) 🤖`
    }

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
   * Generate Composer source URL for packages (like npm)
   */
  private getComposerSourceUrl(repositoryUrl: string, packageName: string): string {
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
        return `https://redirect.github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/${typeName}`
      }

      // For regular GitHub repositories
      if (url.hostname === 'github.com') {
        return `${cleanUrl}/tree/master` // Assuming master branch for source link
      }

      // Fallback to repository URL
      return cleanUrl
    }
    catch {
      return repositoryUrl
    }
  }

  /**
   * Generate a constraint-style version change (e.g., ^3.0 -> ^3.10.0)
   */
  private getConstraintStyleChange(currentVersion: string, newVersion: string): string {
    // Extract base versions (remove any v prefix)
    const cleanCurrent = currentVersion.replace(/^v/, '')
    const cleanNew = newVersion.replace(/^v/, '')

    // For constraint updates, we want to show the constraint form
    // e.g., 3.0 -> 3.10.0 becomes ^3.0 -> ^3.10.0
    const currentConstraint = `^${cleanCurrent}`
    const newConstraint = `^${cleanNew}`

    return `${currentConstraint} -> ${newConstraint}`
  }

  /**
   * Generate a redirect source URL for Composer packages (like npm)
   */
  private getComposerRedirectSourceUrl(repositoryUrl: string, packageName: string): string {
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
        return `https://redirect.github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/${typeName}`
      }

      // For regular GitHub repositories, use redirect.github.com
      if (url.hostname === 'github.com') {
        const pathParts = url.pathname.split('/').filter(p => p)
        if (pathParts.length >= 2) {
          const owner = pathParts[0]
          const repo = pathParts[1]
          return `https://redirect.github.com/${owner}/${repo}`
        }
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

  /**
   * Determine update type between two versions
   */
  private getUpdateType(currentVersion: string, newVersion: string): 'major' | 'minor' | 'patch' {
    // Remove any prefixes like ^, ~, >=, v, @, etc.
    const cleanCurrent = currentVersion.replace(/^[v^~>=<@]+/, '')
    const cleanNew = newVersion.replace(/^[v^~>=<@]+/, '')

    const currentParts = cleanCurrent.split('.').map((part) => {
      const num = Number(part)
      return Number.isNaN(num) ? 0 : num
    })
    const newParts = cleanNew.split('.').map((part) => {
      const num = Number(part)
      return Number.isNaN(num) ? 0 : num
    })

    // Ensure we have at least major.minor.patch structure
    while (currentParts.length < 3) currentParts.push(0)
    while (newParts.length < 3) newParts.push(0)

    // Compare major version
    if (newParts[0] > currentParts[0]) {
      return 'major'
    }

    // Compare minor version
    if (newParts[0] === currentParts[0] && newParts[1] > currentParts[1]) {
      return 'minor'
    }

    // Everything else is patch
    return 'patch'
  }

  /**
   * Generate a description of the version change
   */
  private getVersionChangeDescription(currentVersion: string, newVersion: string, updateType: 'major' | 'minor' | 'patch'): string {
    const descriptions = {
      major: '🔴 Breaking changes possible',
      minor: '🟡 New features added',
      patch: '🟢 Bug fixes & patches',
    }
    return descriptions[updateType]
  }
}
