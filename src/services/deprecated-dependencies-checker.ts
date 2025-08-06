import type { Dependency, PackageFile } from '../types'

export interface DeprecatedDependency {
  /** Package name */
  name: string
  /** Current version being used */
  currentVersion: string
  /** Datasource (npm, bun, composer, etc.) */
  datasource: string
  /** File where dependency is defined */
  file: string
  /** Dependency type */
  type: string
  /** Whether a replacement PR is available */
  replacementAvailable: boolean
  /** Suggested replacement package (if available) */
  suggestedReplacement?: string
  /** Deprecation message from registry */
  deprecationMessage?: string
}

export class DeprecatedDependenciesChecker {
  /**
   * Check for deprecated dependencies across all package files
   */
  async checkDeprecatedDependencies(packageFiles: PackageFile[]): Promise<DeprecatedDependency[]> {
    const deprecated: DeprecatedDependency[] = []

    for (const file of packageFiles) {
      const fileDeprecated = await this.checkFileForDeprecatedDependencies(file)
      deprecated.push(...fileDeprecated)
    }

    return deprecated
  }

  /**
   * Check a single package file for deprecated dependencies
   */
  private async checkFileForDeprecatedDependencies(file: PackageFile): Promise<DeprecatedDependency[]> {
    const deprecated: DeprecatedDependency[] = []

    for (const dependency of file.dependencies) {
      const isDeprecated = await this.checkDependencyDeprecation(dependency, file.type)

      if (isDeprecated.deprecated) {
        deprecated.push({
          name: dependency.name,
          currentVersion: dependency.currentVersion,
          datasource: this.getDatasourceFromFileType(file.type),
          file: file.path,
          type: dependency.type,
          replacementAvailable: false, // We'll enhance this later
          deprecationMessage: isDeprecated.message,
          suggestedReplacement: isDeprecated.suggestedReplacement,
        })
      }
    }

    return deprecated
  }

  /**
   * Check if a specific dependency is deprecated
   */
  private async checkDependencyDeprecation(dependency: Dependency, fileType: string): Promise<{ deprecated: boolean, message?: string, suggestedReplacement?: string }> {
    try {
      // Handle different package managers
      if (fileType === 'package.json' || fileType.includes('lock')) {
        return await this.checkNpmDeprecation(dependency)
      }
      else if (fileType === 'composer.json' || fileType === 'composer.lock') {
        return await this.checkComposerDeprecation(dependency)
      }
      else if (fileType === 'deps.yaml' || fileType === 'deps.yml' || fileType.includes('deps')) {
        return await this.checkBunDeprecation(dependency)
      }

      return { deprecated: false }
    }
    catch (error) {
      console.warn(`Failed to check deprecation for ${dependency.name}:`, error)
      return { deprecated: false }
    }
  }

  /**
   * Check npm package deprecation
   */
  private async checkNpmDeprecation(dependency: Dependency): Promise<{ deprecated: boolean, message?: string, suggestedReplacement?: string }> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${dependency.name}`)

      if (!response.ok) {
        return { deprecated: false }
      }

      const data = await response.json() as any

      // Check if the package is deprecated
      if (data.deprecated) {
        return {
          deprecated: true,
          message: data.deprecated,
          suggestedReplacement: this.extractSuggestedReplacement(data.deprecated),
        }
      }

      // Check if the specific version is deprecated
      const versionData = data.versions?.[dependency.currentVersion]
      if (versionData?.deprecated) {
        return {
          deprecated: true,
          message: versionData.deprecated,
          suggestedReplacement: this.extractSuggestedReplacement(versionData.deprecated),
        }
      }

      return { deprecated: false }
    }
    catch (error) {
      console.warn(`Failed to check npm deprecation for ${dependency.name}:`, error)
      return { deprecated: false }
    }
  }

  /**
   * Check Composer package deprecation
   */
  private async checkComposerDeprecation(dependency: Dependency): Promise<{ deprecated: boolean, message?: string, suggestedReplacement?: string }> {
    try {
      const response = await fetch(`https://packagist.org/packages/${dependency.name}.json`)

      if (!response.ok) {
        return { deprecated: false }
      }

      const data = await response.json() as any

      // Check if the package is abandoned (Composer's equivalent of deprecated)
      if (data.package?.abandoned) {
        const replacement = typeof data.package.abandoned === 'string' ? data.package.abandoned : null
        return {
          deprecated: true,
          message: `Package is abandoned${replacement ? `, use ${replacement} instead` : ''}`,
          suggestedReplacement: replacement || undefined,
        }
      }

      return { deprecated: false }
    }
    catch (error) {
      console.warn(`Failed to check Composer deprecation for ${dependency.name}:`, error)
      return { deprecated: false }
    }
  }

  /**
   * Check Bun package deprecation (using npm registry for now)
   */
  private async checkBunDeprecation(dependency: Dependency): Promise<{ deprecated: boolean, message?: string, suggestedReplacement?: string }> {
    // Bun uses npm registry, so we can reuse the npm check
    return await this.checkNpmDeprecation(dependency)
  }

  /**
   * Extract suggested replacement from deprecation message
   */
  private extractSuggestedReplacement(message: string): string | undefined {
    // Common patterns for replacement suggestions
    const patterns = [
      /use\s+([a-z0-9@/-]+)\s+instead/i,
      /replaced\s+by\s+([a-z0-9@/-]+)/i,
      /migrate\s+to\s+([a-z0-9@/-]+)/i,
      /switch\s+to\s+([a-z0-9@/-]+)/i,
    ]

    for (const pattern of patterns) {
      const match = message.match(pattern)
      if (match) {
        return match[1]
      }
    }

    return undefined
  }

  /**
   * Get datasource name from file type
   */
  private getDatasourceFromFileType(fileType: string): string {
    if (fileType === 'package.json' || fileType.includes('lock')) {
      return 'npm'
    }
    else if (fileType === 'composer.json' || fileType === 'composer.lock') {
      return 'composer'
    }
    else if (fileType === 'deps.yaml' || fileType === 'deps.yml' || fileType.includes('deps')) {
      return 'bun'
    }
    else if (fileType === 'github-actions') {
      return 'github-actions'
    }

    return 'unknown'
  }
}
