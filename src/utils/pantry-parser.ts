import type { Dependency, PackageFile } from '../types'

/**
 * Interface for pantry.lock file structure
 */
export interface PantryLock {
  version: string
  packages: Record<string, PantryPackage>
}

/**
 * Interface for a single pantry package entry
 */
export interface PantryPackage {
  name: string
  version: string
  resolved: string
}

/**
 * Check if a file is a pantry.lock file
 */
export function isPantryLockFile(filePath: string): boolean {
  const fileName = filePath.split('/').pop() || ''
  return fileName === 'pantry.lock'
}

/**
 * Parse a pantry.lock file and extract dependencies
 */
export async function parsePantryLockFile(filePath: string, content: string): Promise<PackageFile | null> {
  try {
    const lockData: PantryLock = JSON.parse(content)
    const dependencies: Dependency[] = []

    if (lockData.packages) {
      for (const pkg of Object.values(lockData.packages)) {
        if (pkg.name && pkg.version) {
          dependencies.push({
            name: pkg.name,
            currentVersion: pkg.version,
            type: 'dependencies',
            file: filePath,
          })
        }
      }
    }

    return {
      path: filePath,
      type: 'pantry.lock',
      content,
      dependencies,
    }
  }
  catch (error) {
    console.warn(`Failed to parse pantry.lock file ${filePath}:`, error)
    return null
  }
}
