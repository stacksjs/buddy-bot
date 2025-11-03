/* eslint-disable no-console */
import type { Dependency, PackageFile, PackageUpdate } from '../types'

/**
 * Check if a file path is a Zig build manifest file
 */
export function isZigManifest(filePath: string): boolean {
  const fileName = filePath.split('/').pop() || ''
  return fileName === 'build.zig.zon'
}

/**
 * Parse a build.zig.zon file
 * The format uses Zig Object Notation (ZON), which is similar to Zig struct literals
 */
export async function parseZigManifest(filePath: string, content: string): Promise<PackageFile | null> {
  try {
    if (!isZigManifest(filePath)) {
      return null
    }

    const dependencies: Dependency[] = []

    // Parse dependencies from the .dependencies block
    // Format: .dependencies = .{ .package_name = .{ .url = "...", .hash = "..." }, }
    const dependenciesMatch = content.match(/\.dependencies\s*=\s*\.?\{([^}]*)\}/)

    if (dependenciesMatch) {
      const dependenciesBlock = dependenciesMatch[1]

      // Match each dependency entry: .package_name = .{ .url = "...", ... }
      const depRegex = /\.(\w+)\s*=\s*\.?\{([^}]*)\}/g
      let match = depRegex.exec(dependenciesBlock)

      while (match !== null) {
        const packageName = match[1]
        const depContent = match[2]

        // Extract URL to get version information
        const urlMatch = depContent.match(/\.url\s*=\s*"([^"]+)"/)
        const hashMatch = depContent.match(/\.hash\s*=\s*"([^"]+)"/)

        if (urlMatch) {
          const url = urlMatch[1]
          // Try to extract version from URL (common patterns: /v1.2.3/, /1.2.3/, etc.)
          const versionMatch = url.match(/\/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i)
          const version = versionMatch ? versionMatch[1] : 'unknown'

          const metadata: Record<string, string> = { url }
          if (hashMatch) {
            metadata.hash = hashMatch[1]
          }

          dependencies.push({
            name: packageName,
            currentVersion: version,
            type: 'zig-dependencies',
            file: filePath,
            metadata,
          })
        }

        match = depRegex.exec(dependenciesBlock)
      }
    }

    return {
      path: filePath,
      type: 'build.zig.zon' as PackageFile['type'],
      content,
      dependencies,
    }
  }
  catch (error) {
    console.warn(`Failed to parse Zig manifest ${filePath}:`, error)
    return null
  }
}

/**
 * Update Zig manifest file content with new package versions
 */
export async function updateZigManifest(filePath: string, content: string, updates: PackageUpdate[]): Promise<string> {
  try {
    if (!isZigManifest(filePath)) {
      console.log(`⚠️ updateZigManifest: ${filePath} is not a Zig manifest file, returning original content`)
      return content
    }

    let updatedContent = content

    // Apply updates to each package
    for (const update of updates) {
      const cleanPackageName = update.name.trim()

      // Find the dependency block for this package
      // Pattern: .package_name = .{ .url = "...", .hash = "..." }
      const depBlockRegex = new RegExp(
        `(\\.${cleanPackageName}\\s*=\\s*\\.?\\{[^}]*\\.url\\s*=\\s*")([^"]+)("[^}]*\\})`,
        's',
      )

      const match = updatedContent.match(depBlockRegex)
      if (match) {
        const [fullMatch, prefix, oldUrl, suffix] = match

        // Replace version in URL
        // Common patterns: /v1.2.3/, /tags/v1.2.3, /archive/v1.2.3.tar.gz
        const versionPattern = /\/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i
        const newUrl = oldUrl.replace(versionPattern, (match: string) => {
          // Preserve the 'v' prefix if it exists
          const hasVPrefix = match.startsWith('/v')
          return hasVPrefix ? `/v${update.newVersion}` : `/${update.newVersion}`
        })

        // Replace the entire dependency block with updated URL
        const replacement = `${prefix}${newUrl}${suffix}`
        updatedContent = updatedContent.replace(fullMatch, replacement)

        console.log(`✅ Updated ${cleanPackageName} from ${match[2]} to ${newUrl}`)
      }
      else {
        console.warn(`⚠️ Could not find dependency block for ${cleanPackageName} in ${filePath}`)
      }
    }

    return updatedContent
  }
  catch (error) {
    console.warn(`Failed to update Zig manifest ${filePath}:`, error)
    return content
  }
}

/**
 * Generate file changes for Zig manifest files
 */
export async function generateZigManifestUpdates(updates: PackageUpdate[]): Promise<Array<{ path: string, content: string, type: 'update' }>> {
  const fileUpdates: Array<{ path: string, content: string, type: 'update' }> = []

  // Group updates by file
  const updatesByFile = new Map<string, PackageUpdate[]>()

  for (const update of updates) {
    if (isZigManifest(update.file)) {
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
        const updatedContent = await updateZigManifest(filePath, currentContent, packageUpdates)

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
        console.warn(`⚠️ Zig manifest file ${filePath} does not exist`)
      }
    }
    catch (error) {
      console.warn(`Failed to generate updates for Zig manifest ${filePath}:`, error)
    }
  }

  return fileUpdates
}
