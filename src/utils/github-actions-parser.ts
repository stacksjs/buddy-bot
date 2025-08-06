/* eslint-disable no-console */
import type { Dependency, PackageFile, PackageUpdate } from '../types'
import process from 'node:process'

/**
 * Check if a file path is a GitHub Actions workflow file
 */
export function isGitHubActionsFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/')
  return normalizedPath.includes('.github/workflows/') && (normalizedPath.endsWith('.yml') || normalizedPath.endsWith('.yaml'))
}

/**
 * Parse a GitHub Actions workflow file to extract action dependencies
 */
export async function parseGitHubActionsFile(filePath: string, content: string): Promise<PackageFile | null> {
  try {
    if (!isGitHubActionsFile(filePath)) {
      return null
    }

    const dependencies: Dependency[] = []

    // Parse YAML-like structure to find action uses
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      // Look for "uses:" declarations (both direct and in array items)
      // Matches: "uses:" or "- uses:"
      const usesMatch = trimmed.match(/^-?\s*uses:\s*(.+)/)
      if (usesMatch) {
        const actionRef = usesMatch[1].trim().replace(/['"`]/g, '') // Remove quotes

        // Skip local actions (starting with ./) and docker actions
        if (actionRef.startsWith('./') || actionRef.startsWith('docker://')) {
          continue
        }

        // Parse action@version format
        const actionParts = actionRef.split('@')
        if (actionParts.length === 2) {
          const [actionName, versionRaw] = actionParts

          // Skip if action name is empty or just whitespace
          if (!actionName || !actionName.trim()) {
            continue
          }

          // Clean version by removing comments and extra whitespace
          const version = versionRaw.split('#')[0].trim()

          const actionDep = {
            name: actionName.trim(),
            currentVersion: version,
            type: 'github-actions' as const,
            file: filePath,
          }

          // Only add if we don't already have this action@version combination for this file
          const existing = dependencies.find(dep =>
            dep.name === actionDep.name
            && dep.currentVersion === actionDep.currentVersion,
          )

          if (!existing) {
            dependencies.push(actionDep)
          }
        }
      }
    }

    // const fileName = filePath.split('/').pop() || ''

    return {
      path: filePath,
      type: 'github-actions',
      content,
      dependencies,
    }
  }
  catch (error) {
    console.warn(`Failed to parse GitHub Actions file ${filePath}:`, error)
    return null
  }
}

/**
 * Update action versions in a GitHub Actions workflow file
 */
export async function updateGitHubActionsFile(
  filePath: string,
  content: string,
  updates: PackageUpdate[],
): Promise<string> {
  try {
    if (!isGitHubActionsFile(filePath)) {
      return content
    }

    let updatedContent = content

    for (const update of updates) {
      // Clean action name (remove any extra info)
      const cleanActionName = update.name.replace(/\s*\(.*\)$/, '')

      // Create regex to match the action usage
      // Matches: uses: action-name@old-version (with optional quotes and dash)
      // This handles: "uses: action@version", "- uses: action@version", etc.
      const actionPattern = new RegExp(
        `((?:^\\s*-\\s*)?uses:\\s*["\']?)(${cleanActionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})@(${update.currentVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(["\']?)`,
        'gm',
      )

      updatedContent = updatedContent.replace(
        actionPattern,
        `$1$2@${update.newVersion}$4`,
      )
    }

    return updatedContent
  }
  catch (error) {
    console.warn(`Failed to update GitHub Actions file ${filePath}:`, error)
    return content
  }
}

/**
 * Generate file changes for GitHub Actions workflow files
 */
export async function generateGitHubActionsUpdates(updates: PackageUpdate[]): Promise<Array<{ path: string, content: string, type: 'update' }>> {
  const fileUpdates: Array<{ path: string, content: string, type: 'update' }> = []

  // Group updates by file
  const updatesByFile = new Map<string, PackageUpdate[]>()

  for (const update of updates) {
    if (isGitHubActionsFile(update.file)) {
      if (!updatesByFile.has(update.file)) {
        updatesByFile.set(update.file, [])
      }
      updatesByFile.get(update.file)!.push(update)
    }
  }

  // Process each file
  for (const [filePath, actionUpdates] of updatesByFile) {
    try {
      // Read current file content
      const fs = await import('node:fs')
      if (fs.existsSync(filePath)) {
        const currentContent = fs.readFileSync(filePath, 'utf-8')
        const updatedContent = await updateGitHubActionsFile(filePath, currentContent, actionUpdates)

        fileUpdates.push({
          path: filePath,
          content: updatedContent,
          type: 'update',
        })
      }
    }
    catch (error) {
      console.warn(`Failed to generate updates for GitHub Actions file ${filePath}:`, error)
    }
  }

  return fileUpdates
}

/**
 * Fetch latest version for a GitHub Action from GitHub API
 */
export async function fetchLatestActionVersion(actionName: string): Promise<string | null> {
  try {
    // GitHub Actions are typically in the format owner/repo
    if (!actionName.includes('/')) {
      console.log(`⚠️ Invalid action name format: ${actionName}`)
      return null
    }

    const [owner, repo] = actionName.split('/')
    console.log(`🔍 Fetching latest version for ${owner}/${repo}`)

    // Prepare headers with authentication if available
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'buddy-bot',
    }

    // Add authentication if GitHub token is available
    const token = process.env.GITHUB_TOKEN
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    // First try to get the latest release
    console.log(`📡 Trying latest release for ${owner}/${repo}`)
    const latestResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers,
    })

    if (latestResponse.ok) {
      const release = await latestResponse.json() as { tag_name?: string }
      if (release.tag_name) {
        console.log(`✅ Found latest release: ${release.tag_name}`)
        return release.tag_name
      }
    }
    else {
      console.log(`⚠️ Latest release not found: ${latestResponse.status} ${latestResponse.statusText}`)
    }

    // If latest release fails or doesn't exist, try to get all releases
    // This helps with actions that don't use the latest tag or have different versioning
    console.log(`📡 Trying all releases for ${owner}/${repo}`)
    const releasesResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`, {
      headers,
    })

    if (releasesResponse.ok) {
      const releases = await releasesResponse.json() as Array<{ tag_name?: string, published_at?: string }>
      console.log(`📋 Found ${releases.length} releases`)

      // Filter out pre-releases and sort by published date
      const stableReleases = releases
        .filter(release => release.tag_name && !release.tag_name.includes('-'))
        .sort((a, b) => {
          const dateA = a.published_at ? new Date(a.published_at).getTime() : 0
          const dateB = b.published_at ? new Date(b.published_at).getTime() : 0
          return dateB - dateA // Sort descending (newest first)
        })

      if (stableReleases.length > 0) {
        console.log(`✅ Found latest stable release: ${stableReleases[0].tag_name}`)
        return stableReleases[0].tag_name || null
      }
    }
    else {
      console.log(`⚠️ Releases not found: ${releasesResponse.status} ${releasesResponse.statusText}`)
    }

    // If we still can't find a release, try to get tags
    console.log(`📡 Trying tags for ${owner}/${repo}`)
    const tagsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=10`, {
      headers,
    })

    if (tagsResponse.ok) {
      const tags = await tagsResponse.json() as Array<{ name?: string }>
      console.log(`📋 Found ${tags.length} tags`)

      // Filter out pre-releases and find the latest stable tag
      const stableTags = tags
        .filter(tag => tag.name && !tag.name.includes('-'))
        .map(tag => tag.name!)
        .sort((a, b) => {
          // Simple version comparison for tags
          // Remove 'v' prefix if present for proper number parsing
          const aClean = a.replace(/^v/, '')
          const bClean = b.replace(/^v/, '')

          const aParts = aClean.split('.').map(Number)
          const bParts = bClean.split('.').map(Number)

          for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aPart = aParts[i] || 0
            const bPart = bParts[i] || 0
            if (aPart !== bPart) {
              return bPart - aPart // Sort descending
            }
          }
          return 0
        })

      if (stableTags.length > 0) {
        console.log(`✅ Found latest stable tag: ${stableTags[0]}`)
        return stableTags[0]
      }
    }
    else {
      console.log(`⚠️ Tags not found: ${tagsResponse.status} ${tagsResponse.statusText}`)
    }

    console.log(`❌ No version found for ${actionName}`)
    return null
  }
  catch (error) {
    console.warn(`Failed to fetch latest version for ${actionName}:`, error)
    return null
  }
}
