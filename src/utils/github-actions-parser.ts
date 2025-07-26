import type { Dependency, PackageFile, PackageUpdate } from '../types'

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

      // Look for "uses:" declarations
      if (trimmed.startsWith('uses:')) {
        const usesMatch = trimmed.match(/uses:\s*(.+)/)
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

            dependencies.push({
              name: actionName,
              currentVersion: version,
              type: 'github-actions',
              file: filePath,
            })
          }
        }
      }
    }

    const fileName = filePath.split('/').pop() || ''
    return {
      path: filePath,
      type: fileName as PackageFile['type'],
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
      // Matches: uses: action-name@old-version
      const actionPattern = new RegExp(
        `(uses:\\s*)(${cleanActionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})@(${update.currentVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
        'g',
      )

      updatedContent = updatedContent.replace(
        actionPattern,
        `$1$2@${update.newVersion}`,
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

    // Call GitHub API to get latest release
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`)

    if (!response.ok) {
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
