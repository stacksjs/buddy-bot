/* eslint-disable no-console */
import type { Dependency, PackageFile, PackageUpdate } from '../types'
import { resolveDependencyFile } from 'ts-pkgx'

/**
 * Check if a file path is a dependency file that we can handle
 */
export function isDependencyFile(filePath: string): boolean {
  const fileName = filePath.split('/').pop() || ''
  const dependencyFileNames = ['deps.yaml', 'dependencies.yaml', 'pkgx.yaml', '.deps.yaml']

  // Check for exact matches
  if (dependencyFileNames.includes(fileName)) {
    return true
  }

  // Check for .yml variants
  const baseNameWithoutExt = fileName.replace(/\.(yaml|yml)$/, '')
  return ['deps', 'dependencies', 'pkgx', '.deps'].includes(baseNameWithoutExt)
}

/**
 * Parse a dependency file using ts-pkgx (supports pkgx registry format)
 */
export async function parseDependencyFile(filePath: string, content: string): Promise<PackageFile | null> {
  try {
    if (!isDependencyFile(filePath)) {
      return null
    }

    // Use ts-pkgx to resolve the dependency file
    const resolvedDeps = await resolveDependencyFile(filePath)

    const dependencies: Dependency[] = []

    if (resolvedDeps && typeof resolvedDeps === 'object') {
      // Parse dependencies from the resolved structure
      // ts-pkgx returns allDependencies array instead of separate sections
      if (resolvedDeps.allDependencies && Array.isArray(resolvedDeps.allDependencies)) {
        for (const dep of resolvedDeps.allDependencies) {
          if (dep.name && dep.constraint) {
            dependencies.push({
              name: dep.name,
              currentVersion: dep.constraint,
              type: 'dependencies', // ts-pkgx doesn't distinguish between dep types for this registry
              file: filePath,
            })
          }
        }
      }

      // Note: ts-pkgx only provides allDependencies, not separate dependencies/devDependencies
      // The fallback parsing is no longer needed since ts-pkgx handles all dependencies in allDependencies
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
    console.warn(`Failed to parse dependency file ${filePath}:`, error)
    return null
  }
}

/**
 * Update dependency file content with new package versions
 */
export async function updateDependencyFile(filePath: string, content: string, updates: PackageUpdate[]): Promise<string> {
  try {
    if (!isDependencyFile(filePath)) {
      return content
    }

    let updatedContent = content

    // Apply updates using string replacement to preserve formatting
    for (const update of updates) {
      // Clean package name (remove dependency type info like "(dev)")
      const cleanPackageName = update.name.replace(/\s*\(dev\)$/, '').replace(/\s*\(peer\)$/, '').replace(/\s*\(optional\)$/, '')

      // Create regex to find the package line and update its version
      // Handle various YAML formats: "package: version", "package:version", "  package: ^version"
      const packageRegex = new RegExp(
        `(\\s*${cleanPackageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*)([^\\n\\r]*)`,
        'g',
      )

      // Extract the original version prefix (^, ~, >=, etc.) or lack thereof
      const currentMatch = updatedContent.match(packageRegex)
      if (currentMatch) {
        const currentVersionMatch = currentMatch[0].match(/:[ \t]*([^\\nr]+)/)
        if (currentVersionMatch) {
          const currentVersionInFile = currentVersionMatch[1].trim()
          const versionPrefixMatch = currentVersionInFile.match(/^(\D*)/)
          const originalPrefix = versionPrefixMatch ? versionPrefixMatch[1] : ''

          // Check if newVersion already has a prefix (to avoid double prefixes)
          const newVersionHasPrefix = /^[\^~>=<]/.test(update.newVersion)

          // Use newVersion as-is if it already has a prefix, otherwise preserve original prefix
          const finalVersion = newVersionHasPrefix ? update.newVersion : `${originalPrefix}${update.newVersion}`

          updatedContent = updatedContent.replace(packageRegex, `$1${finalVersion}`)
        }
      }
    }

    return updatedContent
  }
  catch (error) {
    console.warn(`Failed to update dependency file ${filePath}:`, error)
    return content
  }
}

/**
 * Generate file changes for dependency files
 */
export async function generateDependencyFileUpdates(updates: PackageUpdate[]): Promise<Array<{ path: string, content: string, type: 'update' }>> {
  const fileUpdates: Array<{ path: string, content: string, type: 'update' }> = []

  // Group updates by file
  const updatesByFile = new Map<string, PackageUpdate[]>()

  for (const update of updates) {
    if (isDependencyFile(update.file)) {
      if (!updatesByFile.has(update.file)) {
        updatesByFile.set(update.file, [])
      }
      updatesByFile.get(update.file)!.push(update)
    }
  }

  // Process each file
  for (const [filePath, packageUpdates] of updatesByFile) {
    try {
      // Read current file content
      const fs = await import('node:fs')
      if (fs.existsSync(filePath)) {
        const currentContent = fs.readFileSync(filePath, 'utf-8')
        const updatedContent = await updateDependencyFile(filePath, currentContent, packageUpdates)

        // Only add file update if content actually changed
        if (updatedContent !== currentContent) {
          fileUpdates.push({
            path: filePath,
            content: updatedContent,
            type: 'update',
          })
          console.log(`✅ Generated update for ${filePath} with ${packageUpdates.length} package changes`)
        }
        else {
          console.log(`ℹ️ No changes needed for ${filePath} - versions already up to date`)
        }
      }
      else {
        console.warn(`⚠️ Dependency file ${filePath} does not exist`)
      }
    }
    catch (error) {
      console.warn(`Failed to generate updates for dependency file ${filePath}:`, error)
    }
  }

  return fileUpdates
}
