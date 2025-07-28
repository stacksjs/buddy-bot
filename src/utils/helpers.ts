import type { Dependency, PackageFile, PackageUpdate, UpdateGroup } from '../types'
import { isDependencyFile, parseDependencyFile } from './dependency-file-parser'

/**
 * Parse package file content based on file type
 */
export async function parsePackageFile(content: string, filePath: string): Promise<PackageFile | null> {
  try {
    const fileName = filePath.split('/').pop() || ''

    if (fileName === 'package.json') {
      const packageData = JSON.parse(content)
      const dependencies: Dependency[] = []

      // Extract different dependency types
      extractDependencies(packageData.dependencies, 'dependencies', filePath, dependencies)
      extractDependencies(packageData.devDependencies, 'devDependencies', filePath, dependencies)
      extractDependencies(packageData.peerDependencies, 'peerDependencies', filePath, dependencies)
      extractDependencies(packageData.optionalDependencies, 'optionalDependencies', filePath, dependencies)

      return {
        path: filePath,
        type: 'package.json',
        content,
        dependencies,
      }
    }

    // Handle dependency files (deps.yaml, dependencies.yaml, etc.)
    if (isDependencyFile(filePath)) {
      return await parseDependencyFile(filePath, content)
    }

    // Handle Composer files
    if (fileName === 'composer.json' || fileName === 'composer.lock') {
      const { parseComposerFile } = await import('./composer-parser')
      return await parseComposerFile(filePath, content)
    }

    // Add other file type parsers as needed
    return null
  }
  catch {
    return null
  }
}

/**
 * Extract dependencies from dependency object
 */
function extractDependencies(
  deps: Record<string, string> | undefined,
  type: Dependency['type'],
  filePath: string,
  dependencies: Dependency[],
): void {
  if (!deps)
    return

  for (const [name, version] of Object.entries(deps)) {
    dependencies.push({
      name,
      currentVersion: version,
      type,
      file: filePath,
    })
  }
}

/**
 * Detect package manager based on lock files and configuration
 */
export function detectPackageManager(_projectPath: string): 'bun' | 'npm' | 'yarn' | 'pnpm' {
  // we only support bun for now
  return 'bun'
}

/**
 * Format commit message for dependency updates
 */
export function formatCommitMessage(updates: PackageUpdate[], template?: string): string {
  if (template) {
    // Support custom templates in the future
    return template
  }

  if (updates.length === 1) {
    const update = updates[0]
    return `chore(deps): update dependency ${update.name} to ${update.newVersion}`
  }

  const majorUpdates = updates.filter(u => u.updateType === 'major')
  const minorUpdates = updates.filter(u => u.updateType === 'minor')
  const patchUpdates = updates.filter(u => u.updateType === 'patch')

  if (majorUpdates.length > 0) {
    return `chore(deps): update ${majorUpdates.length} major dependencies`
  }
  else if (minorUpdates.length > 0) {
    return `chore(deps): update ${minorUpdates.length} minor dependencies`
  }
  else {
    return `chore(deps): update ${patchUpdates.length} patch dependencies`
  }
}

/**
 * Format pull request title
 */
export function formatPRTitle(updates: PackageUpdate[], template?: string): string {
  if (template) {
    return template
  }

  if (updates.length === 1) {
    const update = updates[0]
    return `chore(deps): update dependency ${update.name} to v${update.newVersion}`
  }

  const majorUpdates = updates.filter(u => u.updateType === 'major')

  if (majorUpdates.length > 0) {
    return `chore(deps): update ${majorUpdates.length} major dependencies`
  }
  else {
    return `chore(deps): update all non-major dependencies`
  }
}

/**
 * Format pull request body with update details
 */
export function formatPRBody(updates: PackageUpdate[], template?: string): string {
  if (template) {
    return template
  }

  let body = 'This PR contains the following updates:\n\n'
  body += '| Package | Change | Age | Adoption | Passing | Confidence |\n'
  body += '|---|---|---|---|---|---|\n'

  for (const update of updates) {
    const changeText = `\`${update.currentVersion}\` -> \`${update.newVersion}\``
    const packageName = update.metadata?.homepage
      ? `[${update.name}](${update.metadata.homepage})`
      : update.name

    body += `| ${packageName} | ${changeText} | [![age](https://developer.mend.io/api/mc/badges/age/npm/${update.name}/${update.newVersion}?slim=true)](https://docs.renovatebot.com/merge-confidence/) | [![adoption](https://developer.mend.io/api/mc/badges/adoption/npm/${update.name}/${update.newVersion}?slim=true)](https://docs.renovatebot.com/merge-confidence/) | [![passing](https://developer.mend.io/api/mc/badges/compatibility/npm/${update.name}/${update.currentVersion}/${update.newVersion}?slim=true)](https://docs.renovatebot.com/merge-confidence/) | [![confidence](https://developer.mend.io/api/mc/badges/confidence/npm/${update.name}/${update.currentVersion}/${update.newVersion}?slim=true)](https://docs.renovatebot.com/merge-confidence/) |\n`
  }

  body += '\n---\n\n'

  // Add release notes section if available
  const updatesWithReleaseNotes = updates.filter(u => u.releaseNotesUrl)
  if (updatesWithReleaseNotes.length > 0) {
    body += '### Release Notes\n\n'
    for (const update of updatesWithReleaseNotes) {
      if (update.releaseNotesUrl) {
        body += `<details>\n<summary>${update.name}</summary>\n\n`
        body += `[Release Notes](${update.releaseNotesUrl})\n\n`
        body += '</details>\n\n'
      }
    }
  }

  body += '### Configuration\n\n'
  body += '📅 **Schedule**: Branch creation - At any time (no schedule defined), Automerge - At any time (no schedule defined).\n\n'
  body += '🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.\n\n'
  body += '♻ **Rebasing**: Whenever PR is behind base branch, or you tick the rebase/retry checkbox.\n\n'
  body += '🔕 **Ignore**: Close this PR and you won\'t be reminded about this update again.\n\n'
  body += '---\n\n'
  body += ' - [ ] <!-- rebase-check -->If you want to update/retry this PR, check this box\n\n'
  body += '---\n\n'
  body += 'This PR was generated by [Buddy](https://github.com/stacksjs/buddy-bot).'

  return body
}

/**
 * Generate branch name for dependency updates
 */
export function generateBranchName(updates: PackageUpdate[], prefix = 'buddy'): string {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  if (updates.length === 1) {
    const update = updates[0]
    const safeName = update.name.replace(/[^a-z0-9-]/gi, '-')
    return `${prefix}/update-${safeName}-to-${update.newVersion}-${timestamp}`
  }

  const majorUpdates = updates.filter(u => u.updateType === 'major')

  if (majorUpdates.length > 0) {
    return `${prefix}/update-major-dependencies-${timestamp}`
  }
  else {
    return `${prefix}/update-dependencies-${timestamp}`
  }
}

/**
 * Group updates based on configuration and type
 */
export function groupUpdates(updates: PackageUpdate[]): UpdateGroup[] {
  const groups: UpdateGroup[] = []

  // Group by update type
  const majorUpdates = updates.filter(u => u.updateType === 'major')
  const minorUpdates = updates.filter(u => u.updateType === 'minor')
  const patchUpdates = updates.filter(u => u.updateType === 'patch')

  if (majorUpdates.length > 0) {
    groups.push({
      name: 'Major Updates',
      updates: majorUpdates,
      updateType: 'major',
      title: formatPRTitle(majorUpdates),
      body: formatPRBody(majorUpdates),
    })
  }

  if (minorUpdates.length > 0 || patchUpdates.length > 0) {
    const nonMajorUpdates = [...minorUpdates, ...patchUpdates]
    groups.push({
      name: 'Non-Major Updates',
      updates: nonMajorUpdates,
      updateType: minorUpdates.length > 0 ? 'minor' : 'patch',
      title: formatPRTitle(nonMajorUpdates),
      body: formatPRBody(nonMajorUpdates),
    })
  }

  return groups
}

/**
 * Sort updates by priority (major > minor > patch)
 */
export function sortUpdatesByPriority(updates: PackageUpdate[]): PackageUpdate[] {
  const priority = { major: 3, minor: 2, patch: 1 }

  return updates.sort((a, b) => {
    const aPriority = priority[a.updateType]
    const bPriority = priority[b.updateType]

    if (aPriority !== bPriority) {
      return bPriority - aPriority
    }

    // If same priority, sort alphabetically by name
    return a.name.localeCompare(b.name)
  })
}

/**
 * Parse version string and determine update type using Bun's semver
 */
export function getUpdateType(currentVersion: string, newVersion: string): 'major' | 'minor' | 'patch' {
  // Remove any prefixes like ^, ~, >=, v, etc.
  const cleanCurrent = currentVersion.replace(/^[v\^~>=<]+/, '')
  const cleanNew = newVersion.replace(/^[v\^~>=<]+/, '')

  const currentParts = cleanCurrent.split('.').map(Number)
  const newParts = cleanNew.split('.').map(Number)

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
 * Check if version satisfies semver range
 */
export function satisfiesRange(version: string, range: string): boolean {
  // This is a simplified implementation
  // In production, use a proper semver library
  const cleanVersion = version.replace(/^[\^~>=<]+/, '')
  const cleanRange = range.replace(/^[\^~>=<]+/, '')

  return cleanVersion === cleanRange
}

/**
 * Check for PRs that have the rebase checkbox checked
 */
export async function checkForRebaseRequests(token: string, owner: string, repo: string): Promise<Array<{ number: number, branchName: string }>> {
  if (!token) {
    throw new Error('GitHub token is required')
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'buddy-bot',
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    const prs = await response.json() as any[]

    // Filter PRs that have the rebase checkbox checked
    const prsNeedingRebase = prs.filter((pr: any) => {
      if (!pr.body)
        return false

      // Use the same pattern as the CLI for consistency
      const checkedPattern = /- \[x\] <!-- rebase-check -->.*(?:want to (?:rebase|update)\/retry this PR|If you want to (?:rebase|update)\/retry)/i
      return checkedPattern.test(pr.body)
    })

    return prsNeedingRebase.map((pr: any) => ({
      number: pr.number,
      branchName: pr.head.ref,
    }))
  }
  catch (error) {
    throw new Error(`Failed to check for rebase requests: ${error}`)
  }
}
