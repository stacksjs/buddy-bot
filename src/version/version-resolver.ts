import type { PackageUpdate, VersionRange } from '../types'

export class VersionResolver {
  /**
   * Compare two version strings
   */
  static compareVersions(version1: string, version2: string): -1 | 0 | 1 {
    const v1Parts = version1.replace(/^[\^~>=<]+/, '').split('.').map(Number)
    const v2Parts = version2.replace(/^[\^~>=<]+/, '').split('.').map(Number)

    // Ensure both arrays have the same length
    const maxLength = Math.max(v1Parts.length, v2Parts.length)
    while (v1Parts.length < maxLength) v1Parts.push(0)
    while (v2Parts.length < maxLength) v2Parts.push(0)

    for (let i = 0; i < maxLength; i++) {
      if (v1Parts[i] < v2Parts[i]) return -1
      if (v1Parts[i] > v2Parts[i]) return 1
    }

    return 0
  }

  /**
   * Check if a version satisfies a range
   */
  static satisfiesRange(version: string, range: string): boolean {
    // This is a simplified implementation
    // In production, you'd want to use a proper semver library
    const cleanVersion = version.replace(/^[\^~>=<]+/, '')
    const cleanRange = range.replace(/^[\^~>=<]+/, '')

    if (range.startsWith('^')) {
      // Caret range allows minor and patch updates
      const rangeParts = cleanRange.split('.').map(Number)
      const versionParts = cleanVersion.split('.').map(Number)

      return versionParts[0] === rangeParts[0] &&
             this.compareVersions(cleanVersion, cleanRange) >= 0
    }

    if (range.startsWith('~')) {
      // Tilde range allows patch updates only
      const rangeParts = cleanRange.split('.').map(Number)
      const versionParts = cleanVersion.split('.').map(Number)

      return versionParts[0] === rangeParts[0] &&
             versionParts[1] === rangeParts[1] &&
             this.compareVersions(cleanVersion, cleanRange) >= 0
    }

    // Exact match
    return cleanVersion === cleanRange
  }

  /**
   * Get the latest version that satisfies a range
   */
  static getLatestInRange(versions: string[], range: string): string | null {
    const satisfyingVersions = versions.filter(v => this.satisfiesRange(v, range))

    if (satisfyingVersions.length === 0) return null

    return satisfyingVersions.sort((a, b) => this.compareVersions(b, a))[0]
  }

  /**
   * Create a VersionRange object
   */
  static createRange(rangeString: string): VersionRange {
    return {
      raw: rangeString,
      range: rangeString.replace(/^[\^~>=<]+/, ''),
      isExact: !/^[\^~>=<]/.test(rangeString),
      satisfies: (version: string) => this.satisfiesRange(version, rangeString),
      getLatest: (versions: string[]) => this.getLatestInRange(versions, rangeString)
    }
  }

  /**
   * Determine update type between two versions
   */
  static getUpdateType(fromVersion: string, toVersion: string): 'major' | 'minor' | 'patch' {
    const fromParts = fromVersion.replace(/^[\^~>=<]+/, '').split('.').map(Number)
    const toParts = toVersion.replace(/^[\^~>=<]+/, '').split('.').map(Number)

    if (toParts[0] > fromParts[0]) return 'major'
    if (toParts[0] === fromParts[0] && toParts[1] > fromParts[1]) return 'minor'
    return 'patch'
  }

  /**
   * Check if an update is safe based on version range
   */
  static isSafeUpdate(currentRange: string, newVersion: string): boolean {
    if (currentRange.startsWith('^')) {
      // Caret allows minor and patch updates
      const currentVersion = currentRange.replace('^', '')
      const updateType = this.getUpdateType(currentVersion, newVersion)
      return updateType === 'minor' || updateType === 'patch'
    }

    if (currentRange.startsWith('~')) {
      // Tilde allows only patch updates
      const currentVersion = currentRange.replace('~', '')
      const updateType = this.getUpdateType(currentVersion, newVersion)
      return updateType === 'patch'
    }

    // Exact version - no updates are safe
    return false
  }
}
