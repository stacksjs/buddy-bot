import type {
  Dependency,
  Logger,
  PackageFile,
} from '../types'
import { Glob } from 'bun'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { BuddyError } from '../types'
import { isDependencyFile, parseDependencyFile as parseDepFile } from '../utils/dependency-file-parser'
import { isDockerfile, parseDockerfile as parseDockerfileUtil } from '../utils/dockerfile-parser'
import { isGitHubActionsFile, parseGitHubActionsFile } from '../utils/github-actions-parser'
import { parseZigManifest } from '../utils/zig-parser'

export class PackageScanner {
  private ignoreGlobs: Glob[] = []

  constructor(
    private readonly projectPath: string,
    private readonly logger: Logger,
    ignorePaths?: string[],
  ) {
    // Initialize ignore patterns with Bun glob
    if (ignorePaths && ignorePaths.length > 0) {
      this.ignoreGlobs = ignorePaths.map(pattern => new Glob(pattern))
      this.logger.info(`Initialized ${this.ignoreGlobs.length} ignore patterns: ${ignorePaths.join(', ')}`)
    }
  }

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
        if (this.shouldIgnorePath(filePath)) {
          continue
        }
        const packageFile = await this.parsePackageJsonFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
        }
      }

      // Look for dependency files (deps.yaml, dependencies.yaml, etc.)
      const dependencyFiles = await this.findDependencyFiles()
      for (const filePath of dependencyFiles) {
        if (this.shouldIgnorePath(filePath)) {
          continue
        }
        const packageFile = await this.parseDependencyFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
        }
      }

      // Look for lock files
      const lockFiles = await this.findLockFiles()
      for (const filePath of lockFiles) {
        if (this.shouldIgnorePath(filePath)) {
          continue
        }
        const packageFile = await this.parseLockFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
        }
      }

      // Look for Composer files
      const composerFiles = await this.findComposerFiles()
      for (const filePath of composerFiles) {
        if (this.shouldIgnorePath(filePath)) {
          continue
        }
        const packageFile = await this.parseComposerFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
        }
      }

      // Look for GitHub Actions workflows
      const githubActionsFiles = await this.findGitHubActionsFiles()
      for (const filePath of githubActionsFiles) {
        if (this.shouldIgnorePath(filePath)) {
          continue
        }
        const packageFile = await this.parseGitHubActionsFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
        }
      }

      // Look for Dockerfiles
      const dockerfiles = await this.findDockerfiles()
      this.logger.info(`🔍 Found ${dockerfiles.length} Dockerfile(s): ${dockerfiles.join(', ')}`)
      for (const filePath of dockerfiles) {
        if (this.shouldIgnorePath(filePath)) {
          continue
        }
        const packageFile = await this.parseDockerfile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
          this.logger.info(`📦 Parsed Dockerfile: ${filePath} with ${packageFile.dependencies.length} dependencies`)
        }
      }

      // Look for Zig manifest files (build.zig.zon)
      const zigManifests = await this.findZigManifests()
      this.logger.info(`🔍 Found ${zigManifests.length} Zig manifest(s): ${zigManifests.join(', ')}`)
      for (const filePath of zigManifests) {
        if (this.shouldIgnorePath(filePath)) {
          continue
        }
        const packageFile = await this.parseZigManifestFile(filePath)
        if (packageFile) {
          packageFiles.push(packageFile)
          this.logger.info(`📦 Parsed Zig manifest: ${filePath} with ${packageFile.dependencies.length} dependencies`)
        }
      }

      const duration = Date.now() - startTime
      this.logger.success(`Found ${packageFiles.length} package files in ${duration}ms`)

      return packageFiles
    }
    catch (_error) {
      this.logger.error('Failed to scan project:', _error)
      throw new BuddyError(`Failed to scan project: ${_error instanceof Error ? _error.message : 'Unknown error'}`)
    }
  }

  /**
   * Parse a single package.json file
   */
  async parsePackageJsonFile(filePath: string): Promise<PackageFile | null> {
    try {
      const fullPath = join(this.projectPath, filePath)
      const content = await readFile(fullPath, 'utf-8')
      const packageData = JSON.parse(content)

      const dependencies: Dependency[] = []

      // Parse different dependency types
      this.extractDependencies(packageData.dependencies, 'dependencies', filePath, dependencies)
      this.extractDependencies(packageData.devDependencies, 'devDependencies', filePath, dependencies)
      this.extractDependencies(packageData.peerDependencies, 'peerDependencies', filePath, dependencies)
      this.extractDependencies(packageData.optionalDependencies, 'optionalDependencies', filePath, dependencies)

      return {
        path: filePath,
        type: 'package.json',
        content,
        dependencies,
      }
    }
    catch (_error) {
      this.logger.warn(`Failed to parse package.json file ${filePath}:`, _error)
      return null
    }
  }

  /**
   * Parse lock files (simplified for now)
   */
  async parseLockFile(filePath: string): Promise<PackageFile | null> {
    try {
      const fullPath = join(this.projectPath, filePath)
      const content = await readFile(fullPath, 'utf-8')
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
        path: filePath,
        type,
        content,
        dependencies,
      }
    }
    catch (_error) {
      this.logger.warn(`Failed to parse lock file ${filePath}:`, _error)
      return null
    }
  }

  /**
   * Parse a dependency file (deps.yaml, dependencies.yaml, etc.)
   */
  async parseDependencyFile(filePath: string): Promise<PackageFile | null> {
    try {
      const fullPath = join(this.projectPath, filePath)
      const content = await readFile(fullPath, 'utf-8')
      return await parseDepFile(filePath, content)
    }
    catch (_error) {
      this.logger.warn(`Failed to parse dependency file ${filePath}:`, _error)
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
   * Find GitHub Actions workflow files
   */
  private async findGitHubActionsFiles(): Promise<string[]> {
    const workflowFiles: string[] = []

    try {
      // Look for .github/workflows directory
      const githubDir = '.github'
      const workflowsDir = join(this.projectPath, githubDir, 'workflows')

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
    catch {
      // Ignore if .github/workflows doesn't exist
    }

    return workflowFiles
  }

  /**
   * Find Dockerfiles in the project
   */
  private async findDockerfiles(): Promise<string[]> {
    const dockerfiles: string[] = []

    try {
      // Common Dockerfile names
      const dockerfileNames = [
        'Dockerfile',
        'dockerfile',
        'Dockerfile.dev',
        'Dockerfile.prod',
        'Dockerfile.production',
        'Dockerfile.development',
        'Dockerfile.test',
        'Dockerfile.staging',
      ]

      for (const fileName of dockerfileNames) {
        const files = await this.findFiles(fileName)
        dockerfiles.push(...files)
      }

      // Also look for files that start with Dockerfile using pattern matching
      const dockerfilePatterns = await this.findFilesByPattern('Dockerfile*')
      for (const file of dockerfilePatterns) {
        if (!dockerfiles.includes(file) && isDockerfile(file)) {
          dockerfiles.push(file)
        }
      }
    }
    catch {
      // Ignore if no Dockerfiles exist
    }

    return dockerfiles
  }

  /**
   * Parse a GitHub Actions workflow file
   */
  async parseGitHubActionsFile(filePath: string): Promise<PackageFile | null> {
    try {
      const fullPath = join(this.projectPath, filePath)
      const content = await readFile(fullPath, 'utf-8')
      const result = await parseGitHubActionsFile(filePath, content)
      return result
    }
    catch (_error) {
      this.logger.warn(`Failed to parse GitHub Actions file ${filePath}:`, _error)
      return null
    }
  }

  /**
   * Parse a Dockerfile
   */
  async parseDockerfile(filePath: string): Promise<PackageFile | null> {
    try {
      const fullPath = join(this.projectPath, filePath)
      const content = await readFile(fullPath, 'utf-8')
      const result = await parseDockerfileUtil(filePath, content)
      return result
    }
    catch (_error) {
      this.logger.warn(`Failed to parse Dockerfile ${filePath}:`, _error)
      return null
    }
  }

  /**
   * Find Zig manifest files (build.zig.zon) in the project
   */
  private async findZigManifests(): Promise<string[]> {
    const zigManifests: string[] = []

    try {
      // Look for build.zig.zon files
      const manifestFiles = await this.findFiles('build.zig.zon')
      zigManifests.push(...manifestFiles)
    }
    catch {
      // Ignore if no Zig manifests exist
    }

    return zigManifests
  }

  /**
   * Parse a Zig manifest file (build.zig.zon)
   */
  async parseZigManifestFile(filePath: string): Promise<PackageFile | null> {
    try {
      const fullPath = join(this.projectPath, filePath)
      const content = await readFile(fullPath, 'utf-8')
      const result = await parseZigManifest(filePath, content)
      return result
    }
    catch (_error) {
      this.logger.warn(`Failed to parse Zig manifest ${filePath}:`, _error)
      return null
    }
  }

  /**
   * Find Composer files in the project
   */
  private async findComposerFiles(): Promise<string[]> {
    const composerFiles: string[] = []

    try {
      // Look for composer.json files
      const composerJsonFiles = await this.findFiles('composer.json')
      composerFiles.push(...composerJsonFiles)

      // Look for composer.lock files
      const composerLockFiles = await this.findFiles('composer.lock')
      composerFiles.push(...composerLockFiles)
    }
    catch {
      // Ignore if composer files don't exist
    }

    return composerFiles
  }

  /**
   * Parse a Composer file (composer.json or composer.lock)
   */
  async parseComposerFile(filePath: string): Promise<PackageFile | null> {
    try {
      const fullPath = join(this.projectPath, filePath)
      const content = await readFile(fullPath, 'utf-8')
      const { parseComposerFile } = await import('../utils/composer-parser')
      const result = await parseComposerFile(filePath, content)
      return result
    }
    catch (_error) {
      this.logger.warn(`Failed to parse Composer file ${filePath}:`, _error)
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
        this.logger.warn(`Failed to parse package-lock.json:`, _error)
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

        try {
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
            // eslint-disable-next-line ts/no-require-imports
            const path = require('node:path')
            const relativePath = path.relative(this.projectPath, fullPath)
            files.push(relativePath)
          }
        }
        catch {
          // Skip broken symlinks or permission errors on individual files
          continue
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
          // eslint-disable-next-line ts/no-require-imports
          const path = require('node:path')
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
          // eslint-disable-next-line ts/no-require-imports
          const path = require('node:path')
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
   * Check if a path should be ignored based on glob patterns
   */
  private shouldIgnorePath(filePath: string): boolean {
    if (this.ignoreGlobs.length === 0) {
      return false
    }

    // If the path is already relative (doesn't start with /), use it as-is
    // Otherwise, convert to relative path
    let relativePath = filePath
    if (filePath.startsWith('/') || filePath.includes(':')) {
      relativePath = this.getRelativePath(filePath)
    }

    // Check if any ignore pattern matches this path
    for (const glob of this.ignoreGlobs) {
      if (glob.match(relativePath)) {
        this.logger.debug(`Ignoring path: ${relativePath} (matched pattern)`)
        return true
      }
    }

    return false
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
    // eslint-disable-next-line ts/no-require-imports
    const path = require('node:path')
    return path.relative(this.projectPath, absolutePath)
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
