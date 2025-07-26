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
          const [actionName, version] = actionParts

          // Skip if action name is empty or just whitespace
          if (!actionName || !actionName.trim()) {
            continue
          }

          const actionDep = {
            name: actionName.trim(),
            currentVersion: version.trim(),
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
      return null
    }

    const [owner, repo] = actionName.split('/')

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

    // Call GitHub API to get latest release
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers,
    })

    if (!response.ok) {
      // Only log if verbose mode or if it's not a rate limit error
      if (response.status !== 403) {
        console.warn(`GitHub API error for ${actionName}: ${response.status} ${response.statusText}`)
      }
      return null
    }

    const release = await response.json() as { tag_name?: string }
    return release.tag_name || null
  }
  catch (error) {
    console.warn(`Failed to fetch latest version for ${actionName}:`, error)
    return null
  }
}
