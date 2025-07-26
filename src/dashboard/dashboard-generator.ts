import type { DashboardData, PackageFile, PullRequest } from '../types'

export class DashboardGenerator {
  /**
   * Generate the dependency dashboard content
   */
  generateDashboard(data: DashboardData, options: {
    showOpenPRs?: boolean
    showDetectedDependencies?: boolean
    bodyTemplate?: string
  } = {}): { title: string, body: string } {
    const {
      showOpenPRs = true,
      showDetectedDependencies = true,
      bodyTemplate,
    } = options

    const title = 'Dependency Dashboard'

    if (bodyTemplate) {
      return {
        title,
        body: this.applyTemplate(bodyTemplate, data),
      }
    }

    let body = this.generateDefaultHeader(data)

    if (showOpenPRs && data.openPRs.length > 0) {
      body += this.generateOpenPRsSection(data.openPRs)
    }

    if (showDetectedDependencies) {
      body += this.generateDetectedDependenciesSection(data.detectedDependencies)
    }

    body += this.generateFooter()

    return { title, body }
  }

  /**
   * Generate the default header section
   */
  private generateDefaultHeader(data: DashboardData): string {
    const portalUrl = `https://developer.mend.io/github/${data.repository.owner}/${data.repository.name}`

    return `This issue lists Buddy Bot updates and detected dependencies. Read the [Dependency Dashboard](https://buddy-bot.sh/features/dependency-dashboard) docs to learn more.<br/>[View this repository on the Mend.io Web Portal](${portalUrl}).

`
  }

  /**
   * Generate the Open PRs section
   */
  private generateOpenPRsSection(openPRs: PullRequest[]): string {
    let section = `## Open

The following updates have all been created. To force a retry/rebase of any, click on a checkbox below.

`

    for (const pr of openPRs) {
      // Extract package names from PR title or body if possible
      const packageInfo = this.extractPackageInfo(pr)
      const rebaseBranch = pr.head

      section += ` - [ ] <!-- rebase-branch=${rebaseBranch} -->[${pr.title}](${pr.url})`

      if (packageInfo.length > 0) {
        section += ` (\`${packageInfo.join('`, `')}\`)`
      }

      section += '\n'
    }

    section += '\n'
    return section
  }

  /**
   * Generate the Detected Dependencies section
   */
  private generateDetectedDependenciesSection(dependencies: {
    packageJson: PackageFile[]
    dependencyFiles: PackageFile[]
    githubActions: PackageFile[]
  }): string {
    let section = `## Detected dependencies

`

    // Package.json dependencies
    if (dependencies.packageJson.length > 0) {
      section += this.generatePackageJsonSection(dependencies.packageJson)
    }

    // GitHub Actions
    if (dependencies.githubActions.length > 0) {
      section += this.generateGitHubActionsSection(dependencies.githubActions)
    }

    // Other dependency files
    if (dependencies.dependencyFiles.length > 0) {
      section += this.generateDependencyFilesSection(dependencies.dependencyFiles)
    }

    return section
  }

  /**
   * Generate the package.json section
   */
  private generatePackageJsonSection(packageFiles: PackageFile[]): string {
    let section = `<details><summary>npm</summary>
<blockquote>

`

    for (const file of packageFiles) {
      const fileName = file.path.split('/').pop() || file.path
      section += `<details><summary>${fileName}</summary>

`

      // Group dependencies by type
      const depsByType = {
        dependencies: file.dependencies.filter(d => d.type === 'dependencies'),
        devDependencies: file.dependencies.filter(d => d.type === 'devDependencies'),
        peerDependencies: file.dependencies.filter(d => d.type === 'peerDependencies'),
        optionalDependencies: file.dependencies.filter(d => d.type === 'optionalDependencies'),
      }

      for (const [_type, deps] of Object.entries(depsByType)) {
        if (deps.length > 0) {
          for (const dep of deps) {
            section += ` - \`${dep.name} ${dep.currentVersion}\`\n`
          }
        }
      }

      section += `
</details>

`
    }

    section += `</blockquote>
</details>

`

    return section
  }

  /**
   * Generate the GitHub Actions section
   */
  private generateGitHubActionsSection(actionFiles: PackageFile[]): string {
    let section = `<details><summary>github-actions</summary>
<blockquote>

`

    for (const file of actionFiles) {
      section += `<details><summary>${file.path}</summary>

`

      for (const action of file.dependencies) {
        section += ` - \`${action.name} ${action.currentVersion}\`\n`
      }

      section += `
</details>

`
    }

    section += `</blockquote>
</details>

`

    return section
  }

  /**
   * Generate dependency files section
   */
  private generateDependencyFilesSection(dependencyFiles: PackageFile[]): string {
    let section = `<details><summary>dependency-files</summary>
<blockquote>

`

    for (const file of dependencyFiles) {
      section += `<details><summary>${file.path}</summary>

`

      for (const dep of file.dependencies) {
        section += ` - \`${dep.name} ${dep.currentVersion}\`\n`
      }

      section += `
</details>

`
    }

    section += `</blockquote>
</details>

`

    return section
  }

  /**
   * Generate the footer section
   */
  private generateFooter(): string {
    return `---

- [ ] <!-- manual job -->Check this box to trigger a request for Buddy Bot to run again on this repository
`
  }

  /**
   * Extract package names from PR title or body
   */
  private extractPackageInfo(pr: PullRequest): string[] {
    const packages: string[] = []

    // Try to extract from title patterns like "update dependency react to v18"
    const titleMatch = pr.title.match(/update.*?dependency\s+(\w+)/i)
    if (titleMatch) {
      packages.push(titleMatch[1])
    }

    // Try to extract from body if it contains package lists
    const bodyMatches = pr.body.match(/`([^`]+)`/g)
    if (bodyMatches) {
      for (const match of bodyMatches) {
        const packageName = match.replace(/`/g, '').split(' ')[0]
        if (packageName && !packages.includes(packageName)) {
          packages.push(packageName)
        }
      }
    }

    return packages.slice(0, 5) // Limit to first 5 packages to keep it clean
  }

  /**
   * Apply custom template
   */
  private applyTemplate(template: string, data: DashboardData): string {
    return template
      .replace(/\{\{repository\.owner\}\}/g, data.repository.owner)
      .replace(/\{\{repository\.name\}\}/g, data.repository.name)
      .replace(/\{\{openPRs\.count\}\}/g, data.openPRs.length.toString())
      .replace(/\{\{lastUpdated\}\}/g, data.lastUpdated.toISOString())
      .replace(/\{\{detectedDependencies\.packageJson\.count\}\}/g, data.detectedDependencies.packageJson.length.toString())
      .replace(/\{\{detectedDependencies\.githubActions\.count\}\}/g, data.detectedDependencies.githubActions.length.toString())
      .replace(/\{\{detectedDependencies\.dependencyFiles\.count\}\}/g, data.detectedDependencies.dependencyFiles.length.toString())
  }
}
