import type {
  Dependency,
  Logger,
  PackageFile,
} from '../types'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { BuddyError } from '../types'
import { isDependencyFile, parseDependencyFile as parseDepFile } from '../utils/dependency-file-parser'
import { isGitHubActionsFile, parseGitHubActionsFile } from '../utils/github-actions-parser'

export class PackageScanner {
  constructor(
    private readonly projectPath: string,
    private readonly logger: Logger,
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

      // Look for dependency files (deps.yaml, dependencies.yaml, etc.)
      const dependencyFiles = await this.findDependencyFiles()
      for (const filePath of dependencyFiles) {
        const packageFile = await this.parseDependencyFile(filePath)
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

      // Look for GitHub Actions workflows
      const githubActionsFiles = await this.findGitHubActionsFiles()
      for (const filePath of githubActionsFiles) {
        const packageFile = await this.parseGitHubActionsFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
        }
      }

      const duration = Date.now() - startTime
      this.logger.success(`Found ${packageFiles.length} package files in ${duration}ms`)

      return packageFiles
    }
    catch (_error) {
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
        dependencies,
      }
    }
    catch (_error) {
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
      }
      else if (fileName === 'package-lock.json') {
        type = 'package-lock.json'
      }
      else if (fileName === 'yarn.lock') {
        type = 'yarn.lock'
      }
      else if (fileName === 'pnpm-lock.yaml') {
        type = 'pnpm-lock.yaml'
      }
      else {
        return null
      }

      // For lock files, we'll extract basic dependency info
      // More sophisticated parsing would be needed for production use
      const dependencies = await this.extractLockFileDependencies(content, type, filePath)

      return {
        path: this.getRelativePath(filePath),
        type,
        content,
        dependencies,
      }
    }
    catch (_error) {
      this.logger.warn(`Failed to parse lock file ${filePath}:`, error)
      return null
    }
  }

  /**
   * Parse a dependency file (deps.yaml, dependencies.yaml, etc.)
   */
  async parseDependencyFile(filePath: string): Promise<PackageFile | null> {
    try {
      const content = await readFile(filePath, 'utf-8')
      return await parseDepFile(filePath, content)
    }
    catch (_error) {
      this.logger.warn(`Failed to parse dependency file ${filePath}:`, error)
      return null
    }
  }

  /**
   * Find all dependency files in the project
   */
  private async findDependencyFiles(): Promise<string[]> {
    const dependencyFiles: string[] = []
    const dependencyFileNames = ['deps.yaml', 'deps.yml', 'dependencies.yaml', 'dependencies.yml', 'pkgx.yaml', 'pkgx.yml', '.deps.yaml', '.deps.yml']

    for (const fileName of dependencyFileNames) {
      const files = await this.findFiles(fileName)
      dependencyFiles.push(...files)
    }

    // Also check for files that might match our pattern but with different names
    const allYamlFiles = await this.findFilesByPattern('*.yaml')
    const allYmlFiles = await this.findFilesByPattern('*.yml')

    for (const file of [...allYamlFiles, ...allYmlFiles]) {
      if (isDependencyFile(file) && !dependencyFiles.includes(file)) {
        dependencyFiles.push(file)
      }
    }

    return dependencyFiles
  }

  /**
   * Find all GitHub Actions workflow files in the project
   */
  private async findGitHubActionsFiles(): Promise<string[]> {
    const workflowFiles: string[] = []

    try {
      // Look for .github/workflows directory
      const githubDir = '.github'
      const workflowsDir = join(githubDir, 'workflows')

      const stats = await stat(workflowsDir).catch(() => null)
      if (stats?.isDirectory()) {
        const allYamlFiles = await this.findFilesByPatternInDir('*.yaml', workflowsDir)
        const allYmlFiles = await this.findFilesByPatternInDir('*.yml', workflowsDir)

        for (const file of [...allYamlFiles, ...allYmlFiles]) {
          if (isGitHubActionsFile(file)) {
            workflowFiles.push(file)
          }
        }
      }
    }
    catch (_error) {
      // Ignore if .github/workflows doesn't exist
    }

    return workflowFiles
  }

  /**
   * Parse a GitHub Actions workflow file
   */
  async parseGitHubActionsFile(filePath: string): Promise<PackageFile | null> {
    try {
      const content = await readFile(filePath, 'utf-8')
      return await parseGitHubActionsFile(filePath, content)
    }
    catch (_error) {
      this.logger.warn(`Failed to parse GitHub Actions file ${filePath}:`, error)
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
    dependencies: Dependency[],
  ): void {
    if (!deps)
      return

    for (const [name, version] of Object.entries(deps)) {
      dependencies.push({
        name,
        currentVersion: version,
        type,
        file: this.getRelativePath(filePath),
      })
    }
  }

  /**
   * Extract dependencies from lock files (basic implementation)
   */
  private async extractLockFileDependencies(
    content: string,
    type: PackageFile['type'],
    filePath: string,
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
                  file: this.getRelativePath(filePath),
                })
              }
            }
          }
        }
      }
      catch (_error) {
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
        }
        else if (stats.isFile() && entry === fileName) {
          // Convert absolute path to relative path from project root
          const path = await import('node:path')
          const relativePath = path.relative(this.projectPath, fullPath)
          files.push(relativePath)
        }
      }
    }
    catch {
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
   * Find files matching a pattern (simplified implementation)
   */
  private async findFilesByPattern(pattern: string): Promise<string[]> {
    const files: string[] = []
    const extension = pattern.replace('*.', '')

    try {
      const entries = await readdir(this.projectPath)

      for (const entry of entries) {
        const fullPath = join(this.projectPath, entry)
        const stats = await stat(fullPath)

        if (stats.isFile() && entry.endsWith(`.${extension}`)) {
          // Convert absolute path to relative path from project root
          const path = await import('node:path')
          const relativePath = path.relative(this.projectPath, fullPath)
          files.push(relativePath)
        }
        else if (stats.isDirectory() && !this.shouldSkipDirectory(entry)) {
          // Recursively search subdirectories
          const subFiles = await this.findFilesByPatternInDir(pattern, fullPath)
          files.push(...subFiles)
        }
      }
    }
    catch {
      // Ignore permission errors and continue
    }

    return files
  }

  /**
   * Find files matching a pattern in a specific directory
   */
  private async findFilesByPatternInDir(pattern: string, dir: string): Promise<string[]> {
    const files: string[] = []
    const extension = pattern.replace('*.', '')

    try {
      const entries = await readdir(dir)

      for (const entry of entries) {
        const fullPath = join(dir, entry)
        const stats = await stat(fullPath)

        if (stats.isFile() && entry.endsWith(`.${extension}`)) {
          // Convert absolute path to relative path from project root
          const path = await import('node:path')
          const relativePath = path.relative(this.projectPath, fullPath)
          files.push(relativePath)
        }
        else if (stats.isDirectory() && !this.shouldSkipDirectory(entry)) {
          const subFiles = await this.findFilesByPatternInDir(pattern, fullPath)
          files.push(...subFiles)
        }
      }
    }
    catch {
      // Ignore permission errors and continue
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
      '.idea',
    ]

    return skipDirs.includes(dirName) || dirName.startsWith('.')
  }

  /**
   * Get relative path from project root
   */
  private getRelativePath(absolutePath: string): string {
    return absolutePath.replace(`${this.projectPath}/`, '')
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
      index === self.findIndex(d => d.name === dep.name),
    )

    return uniqueDeps
  }
}
