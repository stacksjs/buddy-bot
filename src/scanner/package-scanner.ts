import { readFile, readdir, stat } from 'fs/promises'
import { join, resolve } from 'path'
import type {
  PackageFile,
  Dependency,
  Logger
} from '../types'
import { BuddyError } from '../types'
import { parsePackageFile } from '../utils/helpers'

export class PackageScanner {
  constructor(
    private readonly projectPath: string,
    private readonly logger: Logger
  ) {}

  /**
   * Scan project directory for package files
   */
  async scanProject(): Promise<PackageFile[]> {
    this.logger.info('Scanning project for package files...')
    const startTime = Date.now()

    const packageFiles: PackageFile[] = []

    try {
      // Look for package.json files
      const packageJsonFiles = await this.findFiles('package.json')
      for (const filePath of packageJsonFiles) {
        const packageFile = await this.parsePackageJsonFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
        }
      }

      // Look for lock files
      const lockFiles = await this.findLockFiles()
      for (const filePath of lockFiles) {
        const packageFile = await this.parseLockFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
        }
      }

      const duration = Date.now() - startTime
      this.logger.success(`Found ${packageFiles.length} package files in ${duration}ms`)

      return packageFiles
    } catch (error) {
      this.logger.error('Failed to scan project:', error)
      throw new BuddyError(`Failed to scan project: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Parse a single package.json file
   */
  async parsePackageJsonFile(filePath: string): Promise<PackageFile | null> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const packageData = JSON.parse(content)

      const dependencies: Dependency[] = []

      // Parse different dependency types
      this.extractDependencies(packageData.dependencies, 'dependencies', filePath, dependencies)
      this.extractDependencies(packageData.devDependencies, 'devDependencies', filePath, dependencies)
      this.extractDependencies(packageData.peerDependencies, 'peerDependencies', filePath, dependencies)
      this.extractDependencies(packageData.optionalDependencies, 'optionalDependencies', filePath, dependencies)

      return {
        path: this.getRelativePath(filePath),
        type: 'package.json',
        content,
        dependencies
      }
    } catch (error) {
      this.logger.warn(`Failed to parse package.json file ${filePath}:`, error)
      return null
    }
  }

  /**
   * Parse lock files (simplified for now)
   */
  async parseLockFile(filePath: string): Promise<PackageFile | null> {
    try {
      const content = await readFile(filePath, 'utf-8')
      const fileName = filePath.split('/').pop() || ''

      let type: PackageFile['type']

      if (fileName === 'bun.lockb') {
        type = 'bun.lockb'
      } else if (fileName === 'package-lock.json') {
        type = 'package-lock.json'
      } else if (fileName === 'yarn.lock') {
        type = 'yarn.lock'
      } else if (fileName === 'pnpm-lock.yaml') {
        type = 'pnpm-lock.yaml'
      } else {
        return null
      }

      // For lock files, we'll extract basic dependency info
      // More sophisticated parsing would be needed for production use
      const dependencies = await this.extractLockFileDependencies(content, type, filePath)

      return {
        path: this.getRelativePath(filePath),
        type,
        content,
        dependencies
      }
    } catch (error) {
      this.logger.warn(`Failed to parse lock file ${filePath}:`, error)
      return null
    }
  }

  /**
   * Extract dependencies from a dependency object
   */
  private extractDependencies(
    deps: Record<string, string> | undefined,
    type: Dependency['type'],
    filePath: string,
    dependencies: Dependency[]
  ): void {
    if (!deps) return

    for (const [name, version] of Object.entries(deps)) {
      dependencies.push({
        name,
        currentVersion: version,
        type,
        file: this.getRelativePath(filePath)
      })
    }
  }

  /**
   * Extract dependencies from lock files (basic implementation)
   */
  private async extractLockFileDependencies(
    content: string,
    type: PackageFile['type'],
    filePath: string
  ): Promise<Dependency[]> {
    const dependencies: Dependency[] = []

    // This is a simplified implementation
    // In production, you'd want proper parsers for each lock file format
    if (type === 'package-lock.json') {
      try {
        const lockData = JSON.parse(content)
        if (lockData.packages) {
          for (const [packagePath, packageInfo] of Object.entries(lockData.packages)) {
            if (packagePath && packagePath !== '' && packageInfo && typeof packageInfo === 'object') {
              const pkg = packageInfo as any
              if (pkg.version) {
                const name = packagePath.startsWith('node_modules/')
                  ? packagePath.replace('node_modules/', '')
                  : packagePath

                dependencies.push({
                  name,
                  currentVersion: pkg.version,
                  type: pkg.dev ? 'devDependencies' : 'dependencies',
                  file: this.getRelativePath(filePath)
                })
              }
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to parse package-lock.json:`, error)
      }
    }

    // Add more lock file parsers as needed

    return dependencies
  }

  /**
   * Find all files with a specific name recursively
   */
  private async findFiles(fileName: string, dir = this.projectPath): Promise<string[]> {
    const files: string[] = []

    try {
      const entries = await readdir(dir)

      for (const entry of entries) {
        const fullPath = join(dir, entry)
        const stats = await stat(fullPath)

        if (stats.isDirectory()) {
          // Skip node_modules and other common ignored directories
          if (!this.shouldSkipDirectory(entry)) {
            const subFiles = await this.findFiles(fileName, fullPath)
            files.push(...subFiles)
          }
        } else if (stats.isFile() && entry === fileName) {
          files.push(fullPath)
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
    }

    return files
  }

  /**
   * Find lock files in the project
   */
  private async findLockFiles(): Promise<string[]> {
    const lockFileNames = ['bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']
    const files: string[] = []

    for (const fileName of lockFileNames) {
      const found = await this.findFiles(fileName)
      files.push(...found)
    }

    return files
  }

  /**
   * Check if a directory should be skipped during scanning
   */
  private shouldSkipDirectory(dirName: string): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      '.next',
      '.nuxt',
      'dist',
      'build',
      'coverage',
      '.nyc_output',
      'tmp',
      'temp',
      '.cache',
      '.vscode',
      '.idea'
    ]

    return skipDirs.includes(dirName) || dirName.startsWith('.')
  }

  /**
   * Get relative path from project root
   */
  private getRelativePath(absolutePath: string): string {
    return absolutePath.replace(this.projectPath + '/', '')
  }

  /**
   * Get total dependency count across all files
   */
  async getDependencyCount(): Promise<number> {
    const packageFiles = await this.scanProject()
    return packageFiles.reduce((total, file) => total + file.dependencies.length, 0)
  }

  /**
   * Get unique dependencies across all files
   */
  async getUniqueDependencies(): Promise<Dependency[]> {
    const packageFiles = await this.scanProject()
    const allDeps = packageFiles.flatMap(file => file.dependencies)

    // Remove duplicates based on name
    const uniqueDeps = allDeps.filter((dep, index, self) =>
      index === self.findIndex(d => d.name === dep.name)
    )

    return uniqueDeps
  }
}
