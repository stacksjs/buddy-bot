import type { VersionRange } from '../types'
import { semver } from 'bun'

export class VersionResolver {
  /**
   * Compare two version strings using Bun's fast semver implementation
   */
  static compareVersions(version1: string, version2: string): -1 | 0 | 1 {
    return semver.order(version1, version2)
  }

  /**
   * Check if a version satisfies a range using Bun's fast semver implementation
   */
  static satisfiesRange(version: string, range: string): boolean {
    return semver.satisfies(version, range)
  }

  /**
   * Get the latest version that satisfies a range
   */
  static getLatestInRange(versions: string[], range: string): string | null {
    const satisfyingVersions = versions.filter(v => semver.satisfies(v, range))

    if (satisfyingVersions.length === 0)
      return null

    // Sort using Bun's semver.order (descending)
    return satisfyingVersions.sort((a, b) => semver.order(b, a))[0]
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
      getLatest: (versions: string[]) => this.getLatestInRange(versions, rangeString),
    }
  }

  /**
   * Determine update type between two versions
   */
  static getUpdateType(fromVersion: string, toVersion: string): 'major' | 'minor' | 'patch' {
    // Clean version strings for comparison
    const cleanFrom = fromVersion.replace(/^[\^~>=<]+/, '')
    const cleanTo = toVersion.replace(/^[\^~>=<]+/, '')

    const fromParts = cleanFrom.split('.').map(Number)
    const toParts = cleanTo.split('.').map(Number)

    if (toParts[0] > fromParts[0])
      return 'major'
    if (toParts[0] === fromParts[0] && toParts[1] > fromParts[1])
      return 'minor'
    return 'patch'
  }

  /**
   * Check if an update is safe based on version range
   */
  static isSafeUpdate(currentRange: string, newVersion: string): boolean {
    // Use Bun's semver to check if the new version satisfies the current range
    return semver.satisfies(newVersion, currentRange)
  }
}
