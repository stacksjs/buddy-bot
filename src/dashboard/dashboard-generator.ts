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
  private generateDefaultHeader(_data: DashboardData): string {
    // const portalUrl = `https://developer.mend.io/github/${data.repository.owner}/${data.repository.name}`

    return `This issue lists Buddy Bot updates and detected dependencies. Read the [Dependency Dashboard](https://buddy-bot.sh/features/dependency-dashboard) docs to learn more.

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

      // Convert full GitHub URL to relative format
      const relativeUrl = pr.url.includes('/pull/') && pr.url.includes('github.com')
        ? `../pull/${pr.number}`
        : pr.url

      section += ` - [ ] <!-- rebase-branch=${rebaseBranch} -->[${pr.title}](${relativeUrl})`

      // Show clean package names like Renovate does (without version info)
      if (packageInfo.length > 0) {
        section += ` (\`${packageInfo.join('`, `')}\`)`
      }

      section += '\n'
    }

    // Add the "rebase all open PRs" checkbox like Renovate
    section += ` - [ ] <!-- rebase-all-open-prs -->**Click on this checkbox to rebase all open PRs at once**\n`

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

    // Composer dependencies (separate from other dependency files)
    const composerFiles = dependencies.dependencyFiles.filter(file =>
      file.path === 'composer.json' || file.path.endsWith('/composer.json'),
    )

    // Split composer.json from root vs vendor files
    const rootComposerFiles = composerFiles.filter(file => file.path === 'composer.json')
    const vendorComposerFiles = composerFiles.filter(file => file.path !== 'composer.json')

    if (rootComposerFiles.length > 0) {
      section += this.generateComposerSection(rootComposerFiles)
    }

    // GitHub Actions
    if (dependencies.githubActions.length > 0) {
      section += this.generateGitHubActionsSection(dependencies.githubActions)
    }

    // Other dependency files (excluding composer.json files which are handled above)
    const otherDependencyFiles = dependencies.dependencyFiles.filter(file =>
      !file.path.endsWith('/composer.json') && file.path !== 'composer.json',
    )

    if (otherDependencyFiles.length > 0 || vendorComposerFiles.length > 0) {
      section += this.generateDependencyFilesSection([...otherDependencyFiles, ...vendorComposerFiles])
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

      // Deduplicate actions within this file
      const uniqueActions = new Map<string, { name: string, currentVersion: string }>()

      for (const action of file.dependencies) {
        const key = `${action.name}@${action.currentVersion}`
        if (!uniqueActions.has(key)) {
          uniqueActions.set(key, {
            name: action.name,
            currentVersion: action.currentVersion,
          })
        }
      }

      // Output unique actions
      for (const action of uniqueActions.values()) {
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
   * Generate the Composer section
   */
  private generateComposerSection(composerFiles: PackageFile[]): string {
    let section = `<details><summary>composer</summary>
<blockquote>

`

    for (const file of composerFiles) {
      const fileName = file.path.split('/').pop() || file.path
      section += `<details><summary>${fileName}</summary>

`

      // Group dependencies by type (require, require-dev)
      const depsByType = {
        'require': file.dependencies.filter(d => d.type === 'require'),
        'require-dev': file.dependencies.filter(d => d.type === 'require-dev'),
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
   * Generate the footer section
   */
  private generateFooter(): string {
    return `---

- [ ] <!-- manual job -->Check this box to trigger a request for Buddy Bot to run again on this repository
`
  }

  /**
   * Extract package names from PR title or body (like Renovate does)
   */
  private extractPackageInfo(pr: PullRequest): string[] {
    const packages: string[] = []

    // Pattern 1: Extract from common dependency update titles
    // Examples: "chore(deps): update dependency react to v18"
    //           "chore(deps): update all non-major dependencies"
    //           "update @types/node to v20"
    //           "update require-dev phpunit/phpunit to v12" (Renovate)
    //           "update require symfony/console to v7" (Renovate)
    const titlePatterns = [
      /update.*?dependency\s+(\S+)/i,
      /update\s+require(?:-dev)?\s+(\S+)\s+to\s+v?\d+/i, // Renovate format: "update require-dev package to v12"
      /update\s+(\S+)\s+to\s+v?\d+/i,
      /bump\s+(\S+)\s+from/i,
      /chore\(deps\):\s*update\s+dependency\s+(\S+)/i, // More specific chore(deps) pattern
    ]

    for (const pattern of titlePatterns) {
      const match = pr.title.match(pattern)
      if (match && match[1] && !packages.includes(match[1])) {
        packages.push(match[1])
      }
    }

    // Pattern 2: Extract from table format in PR body - handle all table sections
    // Look for different table types: npm Dependencies, Launchpad/pkgx Dependencies, GitHub Actions

    // Split the body into sections and process each table
    const tableSections = [
      // npm Dependencies table
      { name: 'npm', pattern: /### npm Dependencies[\s\S]*?(?=###|\n\n---|z)/i },
      // Launchpad/pkgx Dependencies table
      { name: 'pkgx', pattern: /### Launchpad\/pkgx Dependencies[\s\S]*?(?=###|\n\n---|z)/i },
      // GitHub Actions table
      { name: 'actions', pattern: /### GitHub Actions[\s\S]*?(?=###|\n\n---|z)/i },
    ]

    for (const section of tableSections) {
      const sectionMatch = pr.body.match(section.pattern)
      if (sectionMatch) {
        const sectionContent = sectionMatch[0]

        // Extract package names from this section's table
        const tableRowMatches = sectionContent.match(/\|\s*\[([^\]]+)\]\([^)]+\)\s*\|/g)
        if (tableRowMatches) {
          for (const match of tableRowMatches) {
            const packageMatch = match.match(/\|\s*\[([^\]]+)\]/)
            if (packageMatch && packageMatch[1]) {
              const packageName = packageMatch[1].trim()

              // Check if this looks like a version string - if so, try to extract package name from URL
              if (packageName.includes('`') && packageName.includes('->')) {
                // This is a version string like "`1.2.17` -> `1.2.19`"
                // Try to extract the package name from the URL
                const urlMatch = match.match(/\]\(([^)]+)\)/)
                if (urlMatch && urlMatch[1]) {
                  const url = urlMatch[1]

                  // Extract package name from Renovate diff URLs like:
                  // https://renovatebot.com/diffs/npm/%40types%2Fbun/1.2.17/1.2.19
                  // https://renovatebot.com/diffs/npm/cac/6.7.13/6.7.14
                  const diffUrlMatch = url.match(/\/diffs\/npm\/([^/]+)\//)
                  if (diffUrlMatch && diffUrlMatch[1]) {
                    // Decode URL encoding like %40types%2Fbun -> @types/bun
                    const extractedPackage = decodeURIComponent(diffUrlMatch[1])

                    if (extractedPackage && extractedPackage.length > 1 && !packages.includes(extractedPackage)) {
                      packages.push(extractedPackage)
                    }
                  }
                }
                continue // Skip the normal processing for version strings
              }

              // Normal processing for direct package names
              // Skip if it's a URL, badge, or contains special characters
              // CRITICAL: Skip version strings like "`1.2.17` -> `1.2.19`"
              if (!packageName.includes('://')
                && !packageName.includes('Compare Source')
                && !packageName.includes('badge')
                && !packageName.includes('!')
                && !packageName.startsWith('[![')
                && !packageName.includes('`') // Skip anything with backticks (version strings)
                && !packageName.includes('->') // Skip version arrows
                && !packageName.includes(' -> ') // Skip spaced version arrows
                && !packageName.match(/^\d+\.\d+/) // Skip version numbers
                && !packageName.includes(' ') // Package names shouldn't have spaces
                && packageName.length > 0
                && !packages.includes(packageName)) {
                packages.push(packageName)
              }
            }
          }
        }
      }
    }

    // Pattern 3: Extract from PR body - look for package names in backticks (avoid table content)
    // This handles cases where the title doesn't contain specific package names
    // but the body lists them like: `@types/bun`, `cac`, `ts-pkgx`
    if (packages.length < 3) { // Allow backtick extraction to supplement table extraction
      const bodyMatches = pr.body.match(/`([^`]+)`/g)
      if (bodyMatches) {
        for (const match of bodyMatches) {
          let packageName = match.replace(/`/g, '').trim()

          // Skip anything that looks like version information
          if (packageName.includes('->')
            || packageName.includes(' -> ')
            || packageName.includes('` -> `')
            || packageName.match(/^\d+\.\d+/) // Starts with version number
            || packageName.match(/^v\d+/) // Version tags
            || packageName.match(/[\d.]+\s*->\s*[\d.]+/) // Version arrows
            || packageName.match(/^[\d.]+$/) // Pure version numbers like "1.2.17"
            || packageName.match(/^\d+\.\d+\.\d+/) // Semver patterns
            || packageName.match(/^\d+\.\d+\.\d+\./) // Longer version patterns
            || packageName.match(/^\^?\d+\.\d+/) // Version ranges like "^1.2.3"
            || packageName.match(/^~\d+\.\d+/) // Tilde version ranges
            || packageName.includes('://') // URLs with protocol
            || packageName.includes('Compare Source')
            || packageName.includes('badge')
            || packageName.includes(' ')) { // Package names shouldn't have spaces
            continue
          }

          // Clean up the package name - take first part only
          packageName = packageName.split(',')[0].trim()

          // Only include if it looks like a valid package/dependency name
          if (packageName
            && packageName.length > 1
            && !packages.includes(packageName)
            && (
          // Must match one of these patterns for valid package names:
              packageName.startsWith('@') // Scoped packages like @types/node
              || packageName.includes('/') // GitHub actions like actions/checkout
              || packageName.match(/^[a-z][a-z0-9.-]*$/i) // Simple package names like lodash, ts-pkgx, bun.com
            )) {
            packages.push(packageName)
          }
        }
      }
    }

    // NO LIMIT - return all packages like Renovate does
    return packages
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
