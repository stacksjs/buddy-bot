import type { Dependency, PackageFile } from '../types'

/**
 * Interface for Composer package data structure
 */
export interface ComposerPackage {
  'name'?: string
  'description'?: string
  'require'?: Record<string, string>
  'require-dev'?: Record<string, string>
  'suggest'?: Record<string, string>
  'conflict'?: Record<string, string>
  'replace'?: Record<string, string>
  'provide'?: Record<string, string>
  'autoload'?: any
  'autoload-dev'?: any
  'scripts'?: Record<string, string | string[]>
  'config'?: any
  'extra'?: any
  'repositories'?: any[]
  'minimum_stability'?: string
  'prefer-stable'?: boolean
  'version'?: string
}

/**
 * Interface for Composer lock file structure
 */
export interface ComposerLock {
  'packages'?: Array<{
    'name': string
    'version': string
    'type'?: string
    'require'?: Record<string, string>
    'require-dev'?: Record<string, string>
  }>
  'packages-dev'?: Array<{
    'name': string
    'version': string
    'type'?: string
    'require'?: Record<string, string>
    'require-dev'?: Record<string, string>
  }>
}

/**
 * Check if a file is a Composer file
 */
export function isComposerFile(filePath: string): boolean {
  const fileName = filePath.split('/').pop() || ''
  return fileName === 'composer.json' || fileName === 'composer.lock'
}

/**
 * Parse a composer.json file and extract dependencies
 */
export async function parseComposerJson(filePath: string, content: string): Promise<PackageFile | null> {
  try {
    const composerData: ComposerPackage = JSON.parse(content)
    const dependencies: Dependency[] = []

    // Extract require dependencies (production)
    if (composerData.require) {
      extractComposerDependencies(composerData.require, 'require', filePath, dependencies)
    }

    // Extract require-dev dependencies (development)
    if (composerData['require-dev']) {
      extractComposerDependencies(composerData['require-dev'], 'require-dev', filePath, dependencies)
    }

    return {
      path: filePath,
      type: 'composer.json',
      content,
      dependencies,
    }
  }
  catch (error) {
    console.warn(`Failed to parse composer.json file ${filePath}:`, error)
    return null
  }
}

/**
 * Parse a composer.lock file and extract dependencies
 */
export async function parseComposerLock(filePath: string, content: string): Promise<PackageFile | null> {
  try {
    const lockData: ComposerLock = JSON.parse(content)
    const dependencies: Dependency[] = []

    // Extract production packages
    if (lockData.packages) {
      for (const pkg of lockData.packages) {
        if (pkg.name && pkg.version) {
          dependencies.push({
            name: pkg.name,
            currentVersion: pkg.version,
            type: 'require',
            file: filePath,
          })
        }
      }
    }

    // Extract development packages
    if (lockData['packages-dev']) {
      for (const pkg of lockData['packages-dev']) {
        if (pkg.name && pkg.version) {
          dependencies.push({
            name: pkg.name,
            currentVersion: pkg.version,
            type: 'require-dev',
            file: filePath,
          })
        }
      }
    }

    return {
      path: filePath,
      type: 'composer.lock',
      content,
      dependencies,
    }
  }
  catch (error) {
    console.warn(`Failed to parse composer.lock file ${filePath}:`, error)
    return null
  }
}

/**
 * Parse a Composer file (composer.json or composer.lock)
 */
export async function parseComposerFile(filePath: string, content: string): Promise<PackageFile | null> {
  const fileName = filePath.split('/').pop() || ''

  if (fileName === 'composer.json') {
    return parseComposerJson(filePath, content)
  }

  if (fileName === 'composer.lock') {
    return parseComposerLock(filePath, content)
  }

  return null
}

/**
 * Extract dependencies from a Composer dependency object
 */
function extractComposerDependencies(
  deps: Record<string, string>,
  type: 'require' | 'require-dev',
  filePath: string,
  dependencies: Dependency[],
): void {
  for (const [name, version] of Object.entries(deps)) {
    // Skip PHP platform requirements and non-package dependencies
    if (name === 'php' || name.startsWith('ext-')) {
      // Skip PHP and extensions
      continue
    }

    // Include packages that have vendor/package format
    if (name.includes('/')) {
      dependencies.push({
        name,
        currentVersion: version,
        type,
        file: filePath,
      })
    }
  }
}

/**
 * Generate updated composer.json content with new dependency versions
 */
export async function generateComposerUpdates(updates: Array<{ name: string, newVersion: string, file: string }>): Promise<Array<{ path: string, content: string, type: 'update' }>> {
  const fileUpdates: Array<{ path: string, content: string, type: 'update' }> = []
  const composerUpdates = updates.filter(update => update.file.endsWith('composer.json'))

  if (composerUpdates.length === 0) {
    return fileUpdates
  }

  // Group updates by file
  const updatesByFile = new Map<string, Array<{ name: string, newVersion: string }>>()

  for (const update of composerUpdates) {
    if (!updatesByFile.has(update.file)) {
      updatesByFile.set(update.file, [])
    }
    updatesByFile.get(update.file)!.push({
      name: update.name,
      newVersion: update.newVersion,
    })
  }

  // Process each composer.json file
  for (const [filePath, fileUpdates_] of updatesByFile) {
    try {
      // Read current composer.json content
      const fs = await import('node:fs')
      let composerContent = fs.readFileSync(filePath, 'utf-8')

      console.log(`🔍 [DEBUG] Reading ${filePath} for updates:`, fileUpdates_.map(u => u.name).join(', '))

      // Parse to understand structure
      const composerData: ComposerPackage = JSON.parse(composerContent)

      console.log(`📋 [DEBUG] Current versions in ${filePath}:`)
      if (composerData.require) {
        for (const [pkg, version] of Object.entries(composerData.require)) {
          console.log(`  ${pkg}: ${version}`)
        }
      }

      // Apply updates using string replacement to preserve formatting
      for (const update of fileUpdates_) {
        let packageFound = false

        // Check in require section
        if (composerData.require && composerData.require[update.name]) {
          const currentVersionInFile = composerData.require[update.name]

          // For complex constraints like ">=6.0,<7.0", preserve the constraint format
          // and just update the version numbers
          let newVersion: string
          if (currentVersionInFile.includes(',')) {
            // Complex constraint - update version numbers while preserving structure
            newVersion = currentVersionInFile.replace(/\d+\.\d+(?:\.\d+)?/g, (match) => {
              // Replace first occurrence with new version, keep others as is for upper bounds
              return match === currentVersionInFile.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ? update.newVersion : match
            })
          }
          else {
            // Simple constraint - extract prefix and apply to new version
            const versionPrefixMatch = currentVersionInFile.match(/^(\D*)/)
            const originalPrefix = versionPrefixMatch ? versionPrefixMatch[1] : ''
            newVersion = `${originalPrefix}${update.newVersion}`
          }

          // Create regex to find the exact line with this package and version
          const packageRegex = new RegExp(
            `("${update.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*")([^"]+)(")`,
            'g',
          )

          composerContent = composerContent.replace(packageRegex, `$1${newVersion}$3`)
          packageFound = true
        }

        // Check in require-dev section
        if (!packageFound && composerData['require-dev'] && composerData['require-dev'][update.name]) {
          const currentVersionInFile = composerData['require-dev'][update.name]

          // For complex constraints like ">=6.0,<7.0", preserve the constraint format
          // and just update the version numbers
          let newVersion: string
          if (currentVersionInFile.includes(',')) {
            // Complex constraint - update version numbers while preserving structure
            newVersion = currentVersionInFile.replace(/\d+\.\d+(?:\.\d+)?/g, (match) => {
              // Replace first occurrence with new version, keep others as is for upper bounds
              return match === currentVersionInFile.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ? update.newVersion : match
            })
          }
          else {
            // Simple constraint - extract prefix and apply to new version
            const versionPrefixMatch = currentVersionInFile.match(/^(\D*)/)
            const originalPrefix = versionPrefixMatch ? versionPrefixMatch[1] : ''
            newVersion = `${originalPrefix}${update.newVersion}`
          }

          const packageRegex = new RegExp(
            `("${update.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*")([^"]+)(")`,
            'g',
          )

          composerContent = composerContent.replace(packageRegex, `$1${newVersion}$3`)
          packageFound = true
        }

        if (!packageFound) {
          console.warn(`Package ${update.name} not found in ${filePath}`)
        }
      }

      fileUpdates.push({
        path: filePath,
        content: composerContent,
        type: 'update' as const,
      })
    }
    catch (error) {
      console.error(`Failed to update ${filePath}:`, error)
    }
  }

  return fileUpdates
}
