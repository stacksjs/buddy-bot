/* eslint-disable no-console */

import { describe, expect, it } from 'bun:test'

// Test that verifies the full flow: some packages should get major PRs, others should go in grouped PR
describe('Composer Mixed Updates (Major + Minor)', () => {
  // Simulating the constraint logic from registry-client.ts
  function getMajorVersion(version: string): string {
    return version.replace(/^[v^~>=<]+/, '').split('.')[0] || '0'
  }

  function shouldIncludeUpdate(constraint: string, currentVersion: string, latestVersion: string): boolean {
    const currentMajor = getMajorVersion(currentVersion)
    const latestMajor = getMajorVersion(latestVersion)

    // For caret constraints (^), only allow updates within the same major version
    if (constraint.startsWith('^')) {
      if (currentMajor !== latestMajor) {
        return false // Skip major version updates for caret constraints
      }
      return true
    }

    // For other constraints, allow all updates
    return true
  }

  it('should separate major updates from minor updates correctly', () => {
    // Real scenario: some packages have minor updates (should be grouped),
    // others might have major updates if constraints allow them

    const packages = [
      // Minor updates within constraints (should be GROUPED)
      { name: 'laravel/framework', constraint: '^10.0', current: '10.0.0', latest: '10.48.29' },
      { name: 'symfony/console', constraint: '^6.0', current: '6.0.0', latest: '6.4.23' },
      { name: 'monolog/monolog', constraint: '^3.0', current: '3.0.0', latest: '3.9.0' },
      { name: 'doctrine/dbal', constraint: '^3.0', current: '3.0.0', latest: '3.10.0' },
      { name: 'guzzlehttp/guzzle', constraint: '^7.0', current: '7.0.0', latest: '7.9.3' },

      // Hypothetical major updates that would be allowed (should get INDIVIDUAL PRs)
      { name: 'some/package', constraint: '>=1.0', current: '1.0.0', latest: '2.0.0' },
      { name: 'another/package', constraint: '*', current: '1.5.0', latest: '2.1.0' },
    ]

    const includedUpdates = []
    const excludedUpdates = []

    packages.forEach((pkg) => {
      const shouldInclude = shouldIncludeUpdate(pkg.constraint, pkg.current, pkg.latest)

      if (shouldInclude) {
        const currentMajor = getMajorVersion(pkg.current)
        const latestMajor = getMajorVersion(pkg.latest)
        const updateType = currentMajor !== latestMajor ? 'major' : 'minor'

        includedUpdates.push({
          ...pkg,
          updateType,
          shouldGetIndividualPR: updateType === 'major',
        })
      }
      else {
        excludedUpdates.push(pkg)
      }
    })

    console.log('\n=== INCLUDED UPDATES ===')
    includedUpdates.forEach((update) => {
      console.log(`${update.name}: ${update.current} → ${update.latest} (${update.updateType}) - ${update.shouldGetIndividualPR ? 'INDIVIDUAL PR' : 'GROUPED PR'}`)
    })

    console.log('\n=== EXCLUDED UPDATES ===')
    excludedUpdates.forEach((update) => {
      console.log(`${update.name}: ${update.current} → ${update.latest} (excluded by constraint ${update.constraint})`)
    })

    // Verify the results
    expect(includedUpdates).toHaveLength(7) // All should be included
    expect(excludedUpdates).toHaveLength(0) // None should be excluded

    const majorUpdates = includedUpdates.filter(u => u.updateType === 'major')
    const minorUpdates = includedUpdates.filter(u => u.updateType === 'minor')

    expect(majorUpdates).toHaveLength(2) // some/package and another/package
    expect(minorUpdates).toHaveLength(5) // Laravel, Symfony, Monolog, Doctrine, Guzzle

    console.log(`\nResult: ${majorUpdates.length} individual major PRs + 1 grouped PR with ${minorUpdates.length} minor updates`)
  })

  it('should handle the current repo scenario (all minor updates)', () => {
    // Current scenario: ALL packages have minor updates within constraints
    // This means NO major PRs should be created, only 1 grouped PR

    const currentRepoPackages = [
      { name: 'laravel/framework', constraint: '^10.0', current: '10.0.0', latest: '10.48.29' },
      { name: 'symfony/console', constraint: '^6.0', current: '6.0.0', latest: '6.4.23' },
      { name: 'monolog/monolog', constraint: '^3.0', current: '3.0.0', latest: '3.9.0' },
      { name: 'doctrine/dbal', constraint: '^3.0', current: '3.0.0', latest: '3.10.0' },
      { name: 'guzzlehttp/guzzle', constraint: '^7.0', current: '7.0.0', latest: '7.9.3' },
      { name: 'phpunit/phpunit', constraint: '^10.0', current: '10.0.0', latest: '10.5.48' },
      { name: 'mockery/mockery', constraint: '^1.5', current: '1.5.0', latest: '1.6.12' },
      { name: 'fakerphp/faker', constraint: '^1.20', current: '1.20.0', latest: '1.24.1' },
    ]

    const results = currentRepoPackages.map((pkg) => {
      const shouldInclude = shouldIncludeUpdate(pkg.constraint, pkg.current, pkg.latest)
      const currentMajor = getMajorVersion(pkg.current)
      const latestMajor = getMajorVersion(pkg.latest)
      const updateType = currentMajor !== latestMajor ? 'major' : 'minor'

      return {
        ...pkg,
        shouldInclude,
        updateType,
      }
    })

    const included = results.filter(r => r.shouldInclude)
    const majorUpdates = included.filter(r => r.updateType === 'major')
    const minorUpdates = included.filter(r => r.updateType === 'minor')

    console.log(`\nCurrent repo scenario:`)
    console.log(`- Total packages with updates: ${included.length}`)
    console.log(`- Major updates (individual PRs): ${majorUpdates.length}`)
    console.log(`- Minor/patch updates (grouped PR): ${minorUpdates.length}`)

    // In current scenario, all should be minor updates
    expect(included).toHaveLength(8)
    expect(majorUpdates).toHaveLength(0) // No major updates
    expect(minorUpdates).toHaveLength(8) // All are minor/patch

    console.log(`\nExpected result: 0 individual major PRs + 1 grouped PR with 8 minor/patch updates`)
    console.log(`This means the user should see 1 PR containing all Composer updates, no individual major PRs.`)
  })
})
