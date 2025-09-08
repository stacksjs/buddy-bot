/* eslint-disable no-cond-assign */
import type { Dependency, PackageFile, PackageUpdate, UpdateGroup } from '../types'
import type { Logger } from './logger'
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
 * Deduplicate updates by package name and version, keeping the most relevant file
 */
function deduplicateUpdates(updates: PackageUpdate[]): PackageUpdate[] {
  const uniqueUpdates = new Map<string, PackageUpdate>()

  for (const update of updates) {
    const key = `${update.name}:${update.currentVersion}:${update.newVersion}`
    const existing = uniqueUpdates.get(key)

    if (!existing) {
      uniqueUpdates.set(key, update)
    }
    else {
      // Keep the update with the most relevant file (prioritize package.json > composer.json > dependency files)
      const currentPriority = getFilePriority(update.file)
      const existingPriority = getFilePriority(existing.file)

      if (currentPriority > existingPriority) {
        uniqueUpdates.set(key, update)
      }
    }
  }

  return Array.from(uniqueUpdates.values())
}

/**
 * Get file priority for deduplication (higher is more important)
 */
function getFilePriority(filePath: string): number {
  if (filePath === 'package.json')
    return 3
  if (filePath.endsWith('composer.json'))
    return 2
  if (filePath.includes('.github/workflows/'))
    return 1
  return 0 // dependency files like deps.yaml
}

/**
 * Group updates based on configuration and type
 */
export function groupUpdates(updates: PackageUpdate[]): UpdateGroup[] {
  const groups: UpdateGroup[] = []

  // Deduplicate updates by package name and version - keep the most relevant file
  const deduplicatedUpdates = deduplicateUpdates(updates)

  // Group by update type
  const majorUpdates = deduplicatedUpdates.filter(u => u.updateType === 'major')
  const minorUpdates = deduplicatedUpdates.filter(u => u.updateType === 'minor')
  const patchUpdates = deduplicatedUpdates.filter(u => u.updateType === 'patch')

  // Create individual PRs for each major update
  for (const majorUpdate of majorUpdates) {
    groups.push({
      name: `Major Update - ${majorUpdate.name}`,
      updates: [majorUpdate],
      updateType: 'major',
      title: `chore(deps): update dependency ${majorUpdate.name} to ${majorUpdate.newVersion}`,
      body: formatPRBody([majorUpdate]),
    })
  }

  if (minorUpdates.length > 0 || patchUpdates.length > 0) {
    const nonMajorUpdates = [...minorUpdates, ...patchUpdates]
    groups.push({
      name: 'Non-Major Updates',
      updates: nonMajorUpdates,
      updateType: minorUpdates.length > 0 ? 'minor' : 'patch',
      title: 'chore(deps): update all non-major dependencies',
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
  // Remove any prefixes like ^, ~, >=, v, @, etc.
  const cleanCurrent = currentVersion.replace(/^[v^~>=<@]+/, '')
  const cleanNew = newVersion.replace(/^[v^~>=<@]+/, '')

  // If not an upgrade or equal, treat as patch (no-op or bugfix)
  try {
    if (Bun.semver.order(cleanNew, cleanCurrent) <= 0)
      return 'patch'
  }
  catch {
    // Fallback to patch if semver fails
    return 'patch'
  }

  try {
    // Parse version parts manually for more reliable comparison
    const currentParts = cleanCurrent.split('.').map(n => parseInt(n, 10))
    const newParts = cleanNew.split('.').map(n => parseInt(n, 10))

    // Ensure we have at least 3 parts (major.minor.patch)
    while (currentParts.length < 3) currentParts.push(0)
    while (newParts.length < 3) newParts.push(0)

    const [currentMajor, currentMinor, currentPatch] = currentParts
    const [newMajor, newMinor, newPatch] = newParts

    // Major version change
    if (newMajor > currentMajor) {
      return 'major'
    }

    // Minor version change (same major, higher minor)
    if (newMajor === currentMajor && newMinor > currentMinor) {
      return 'minor'
    }

    // Patch version change (same major and minor, higher patch)
    if (newMajor === currentMajor && newMinor === currentMinor && newPatch > currentPatch) {
      return 'patch'
    }
  }
  catch {
    // Fallback to semver satisfaction checks if parsing fails
    try {
      // Patch: within same minor series
      if (Bun.semver.satisfies(cleanNew, `~${cleanCurrent}`))
        return 'patch'
    }
    catch {}

    try {
      // Minor: within same major series
      if (Bun.semver.satisfies(cleanNew, `^${cleanCurrent}`))
        return 'minor'
    }
    catch {}
  }

  // Otherwise major
  return 'major'
}

/**
 * Check if version satisfies semver range
 */
export function satisfiesRange(version: string, range: string): boolean {
  try {
    return Bun.semver.satisfies(version, range)
  }
  catch {
    return false
  }
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

/**
 * Extract package names from PR body
 */
export function extractPackageNamesFromPRBody(body: string): string[] {
  const packages: string[] = []

  // Look for package names in the PR body table
  const tableMatch = body.match(/\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|/g)
  if (tableMatch) {
    for (const row of tableMatch) {
      // Extract package name from table row
      const packageMatch = row.match(/\[([^\]]+)\]\([^)]*\)/)
      if (packageMatch) {
        packages.push(packageMatch[1])
      }
    }
  }

  return packages
}

/**
 * Check if a PR should be auto-closed due to configuration changes
 * This handles cases where:
 * 1. respectLatest config changed from false to true, making dynamic version updates invalid
 * 2. ignorePaths config changed to exclude paths that existing PRs contain updates for
 */
export async function checkForAutoClose(pr: any, config: any, logger: Logger): Promise<boolean> {
  // Check for respectLatest config changes
  const shouldCloseForRespectLatest = await checkForAutoCloseRespectLatest(pr, config, logger)
  if (shouldCloseForRespectLatest) {
    return true
  }

  // Check for ignorePaths config changes
  const shouldCloseForIgnorePaths = await checkForAutoCloseIgnorePaths(pr, config, logger)
  if (shouldCloseForIgnorePaths) {
    return true
  }

  return false
}

/**
 * Check if a PR should be auto-closed due to respectLatest config changes
 */
async function checkForAutoCloseRespectLatest(pr: any, config: any, logger: Logger): Promise<boolean> {
  const respectLatest = config.packages?.respectLatest ?? true

  // Only auto-close if respectLatest is true (the new default behavior)
  if (!respectLatest) {
    logger.debug(`🔍 PR #${pr.number}: respectLatest is false, skipping auto-close`)
    return false
  }

  // Check if the existing PR contains updates that would now be filtered out
  // Look for dynamic version indicators in the PR body
  const dynamicIndicators = ['latest', '*', 'main', 'master', 'develop', 'dev']
  const prBody = pr.body.toLowerCase()

  // Check if PR body contains dynamic version indicators
  const hasDynamicVersions = dynamicIndicators.some(indicator => prBody.includes(indicator))
  if (!hasDynamicVersions) {
    logger.debug(`🔍 PR #${pr.number}: No dynamic versions found in PR body`)
    return false
  }

  logger.debug(`🔍 PR #${pr.number}: Found dynamic versions in PR body`)

  // Extract packages from PR body and check if they have dynamic versions
  const packageNames = extractPackageNamesFromPRBody(pr.body)
  logger.debug(`🔍 PR #${pr.number}: Extracted packages: ${packageNames.join(', ')}`)

  // Check if any of the packages in the PR had dynamic versions
  const packagesWithDynamicVersions = packageNames.filter((pkg) => {
    // Look for the package in the PR body table format: | [package](url) | version → newVersion | ... |
    const packagePattern = new RegExp(`\\|\\s*\\[${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\([^)]+\\)\\s*\\|\\s*([^|]+)\\s*\\|`, 'i')
    const match = pr.body.match(packagePattern)
    if (!match) {
      // Fallback: look for any version pattern with this package
      const fallbackPattern = new RegExp(`${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\w]*[:=]\\s*["']?([^"'\n]+)["']?`, 'i')
      const fallbackMatch = pr.body.match(fallbackPattern)
      if (!fallbackMatch) {
        logger.debug(`🔍 PR #${pr.number}: No version pattern found for package ${pkg}`)
        return false
      }

      const version = fallbackMatch[1].toLowerCase().trim().replace(/`/g, '')
      const isDynamic = dynamicIndicators.includes(version)
      logger.debug(`🔍 PR #${pr.number}: Package ${pkg} has version ${version}, isDynamic: ${isDynamic}`)
      return isDynamic
    }

    const versionChange = match[1].trim()
    // Look for patterns like "* → 3.13.5" or "latest → 1.2.3" or "* → 3.13.5"
    const currentVersionMatch = versionChange.match(/^([^→]+)→/)
    if (!currentVersionMatch) {
      logger.debug(`🔍 PR #${pr.number}: Could not parse version change for package ${pkg}: ${versionChange}`)
      return false
    }

    const currentVersion = currentVersionMatch[1].trim().toLowerCase().replace(/`/g, '')
    const isDynamic = dynamicIndicators.includes(currentVersion)
    logger.debug(`🔍 PR #${pr.number}: Package ${pkg} has current version ${currentVersion}, isDynamic: ${isDynamic}`)
    return isDynamic
  })

  const shouldClose = packagesWithDynamicVersions.length > 0
  logger.debug(`🔍 PR #${pr.number}: Packages with dynamic versions: ${packagesWithDynamicVersions.join(', ')}`)
  logger.debug(`🔍 PR #${pr.number}: Should auto-close: ${shouldClose}`)

  return shouldClose
}

/**
 * Check if a PR should be auto-closed due to ignorePaths config changes
 */
async function checkForAutoCloseIgnorePaths(pr: any, config: any, logger: Logger): Promise<boolean> {
  const ignorePaths = config.packages?.ignorePaths
  if (!ignorePaths || ignorePaths.length === 0) {
    logger.debug(`🔍 PR #${pr.number}: No ignorePaths configured, skipping auto-close`)
    return false
  }

  // Extract file paths from the PR body
  const filePaths = extractFilePathsFromPRBody(pr.body)
  if (filePaths.length === 0) {
    logger.debug(`🔍 PR #${pr.number}: No file paths found in PR body`)
    return false
  }

  logger.debug(`🔍 PR #${pr.number}: Found file paths: ${filePaths.join(', ')}`)

  // Check if any of the files in the PR are now in ignored paths
  // eslint-disable-next-line ts/no-require-imports
  const { Glob } = require('bun')

  const ignoredFiles = filePaths.filter((filePath) => {
    // Normalize the file path (remove leading ./ if present)
    const normalizedPath = filePath.replace(/^\.\//, '')

    return ignorePaths.some((pattern: string) => {
      try {
        const glob = new Glob(pattern)
        return glob.match(normalizedPath)
      }
      catch (error) {
        logger.debug(`Failed to match path ${normalizedPath} against pattern ${pattern}: ${error}`)
        return false
      }
    })
  })

  if (ignoredFiles.length > 0) {
    logger.debug(`🔍 PR #${pr.number}: Contains files now in ignorePaths: ${ignoredFiles.join(', ')}`)
    return true
  }

  logger.debug(`🔍 PR #${pr.number}: No files match ignorePaths patterns`)
  return false
}

/**
 * Extract file paths from PR body
 */
function extractFilePathsFromPRBody(prBody: string): string[] {
  const filePaths: string[] = []

  // Look for file paths in the PR body table (File column)
  // Format: | [package](url) | version | **file** | status |
  const tableRowRegex = /\|\s*\[[^\]]+\]\([^)]*\)\s*\|[^|]*\|\s*\*\*([^*]+)\*\*\s*\|/g
  let match
  while ((match = tableRowRegex.exec(prBody)) !== null) {
    const filePath = match[1].trim()
    if (filePath && !filePaths.includes(filePath)) {
      filePaths.push(filePath)
    }
  }

  // Also look for bold file paths without full table structure
  const boldFileRegex = /\*\*([^*]+\.(?:json|yaml|yml|lock))\*\*/g
  while ((match = boldFileRegex.exec(prBody)) !== null) {
    const filePath = match[1].trim()
    if (filePath && !filePaths.includes(filePath)) {
      filePaths.push(filePath)
    }
  }

  // Also look for file paths in a simpler format
  // Format: | package | version | file | status |
  const simpleTableRowRegex = /\|[^|]+\|[^|]+\|([^|]+)\|[^|]*\|/g
  while ((match = simpleTableRowRegex.exec(prBody)) !== null) {
    const filePath = match[1].trim()
    // Only consider paths that look like file paths (contain / or end with common extensions)
    if (filePath && (filePath.includes('/') || /\.(?:json|yaml|yml|lock)$/.test(filePath)) && !filePaths.includes(filePath)) {
      filePaths.push(filePath)
    }
  }

  // Look for file mentions in release notes or other sections
  const filePathRegex = /(?:^|\s)([\w-]+(?:\/[\w.-]+)*\/[\w.-]+\.(?:json|yaml|yml|lock))(?:\s|$)/gm
  while ((match = filePathRegex.exec(prBody)) !== null) {
    const filePath = match[1].trim()
    if (filePath && !filePaths.includes(filePath)) {
      filePaths.push(filePath)
    }
  }

  return filePaths
}
