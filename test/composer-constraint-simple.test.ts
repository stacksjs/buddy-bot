import { describe, expect, it } from 'bun:test'

// Testing the version parsing and constraint logic directly
describe('Composer Version Constraint Logic', () => {
  
  // Helper functions from the registry client
  function getMajorVersion(version: string): string {
    return version.replace(/^[v\^~>=<]+/, '').split('.')[0] || '0'
  }

  function getMinorVersion(version: string): string {
    const parts = version.replace(/^[v\^~>=<]+/, '').split('.')
    return parts[1] || '0'
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
    
    // For tilde constraints (~), handle according to the constraint level
    if (constraint.startsWith('~')) {
      const currentMinor = getMinorVersion(currentVersion)
      const latestMinor = getMinorVersion(latestVersion)
      
      // ~1.2 allows patch updates within 1.2.x
      if (constraint.includes('.')) {
        if (currentMajor !== latestMajor || currentMinor !== latestMinor) {
          return false // Skip if not within same minor version
        }
      } else {
        // ~1 allows minor and patch updates within 1.x.x
        if (currentMajor !== latestMajor) {
          return false // Skip if not within same major version
        }
      }
      return true
    }
    
    // For other constraints (>=, *, etc.), allow all updates
    return true
  }

  it('should correctly parse major versions', () => {
    expect(getMajorVersion('10.0.0')).toBe('10')
    expect(getMajorVersion('v10.48.29')).toBe('10')
    expect(getMajorVersion('6.4.23')).toBe('6')
    expect(getMajorVersion('7.3.1')).toBe('7')
  })

  it('should include minor updates within caret constraints', () => {
    // These should be INCLUDED (minor/patch within constraint)
    expect(shouldIncludeUpdate('^10.0', '10.0.0', '10.48.29')).toBe(true)
    expect(shouldIncludeUpdate('^6.0', '6.0.0', '6.4.23')).toBe(true)
    expect(shouldIncludeUpdate('^3.0', '3.0.0', '3.9.0')).toBe(true)
    expect(shouldIncludeUpdate('^1.5', '1.5.0', '1.6.12')).toBe(true)
  })

  it('should exclude major updates outside caret constraints', () => {
    // These should be EXCLUDED (major updates outside constraint)
    expect(shouldIncludeUpdate('^6.0', '6.4.23', '7.3.1')).toBe(false)
    expect(shouldIncludeUpdate('^10.0', '10.48.29', '12.21.0')).toBe(false)
    expect(shouldIncludeUpdate('^1.0', '1.6.12', '2.0.0')).toBe(false)
  })

  it('should handle tilde constraints correctly', () => {
    // ~1.2.3 should allow only 1.2.x patches
    expect(shouldIncludeUpdate('~1.2.3', '1.2.3', '1.2.5')).toBe(true)
    expect(shouldIncludeUpdate('~1.2.3', '1.2.5', '1.3.0')).toBe(false)
    
    // ~1.2 should allow 1.x.x minor/patch
    expect(shouldIncludeUpdate('~1.2', '1.2.0', '1.5.0')).toBe(true)
    expect(shouldIncludeUpdate('~1.2', '1.5.0', '2.0.0')).toBe(false)
  })

  it('should test real Renovate examples', () => {
    // Real examples from Renovate output that should be included
    const renovateExamples = [
      { constraint: '^10.0', current: '10.0.0', latest: '10.48.29', expected: true },
      { constraint: '^6.0', current: '6.0.0', latest: '6.4.23', expected: true },
      { constraint: '^3.0', current: '3.0.0', latest: '3.9.0', expected: true },
      { constraint: '^7.0', current: '7.0.0', latest: '7.9.3', expected: true },
      { constraint: '^10.0', current: '10.0.0', latest: '10.5.48', expected: true },
      { constraint: '^1.5', current: '1.5.0', latest: '1.6.12', expected: true },
      { constraint: '^1.20', current: '1.20.0', latest: '1.24.1', expected: true },
    ]

    renovateExamples.forEach(({ constraint, current, latest, expected }) => {
      const result = shouldIncludeUpdate(constraint, current, latest)
      expect(result).toBe(expected)
      console.log(`${constraint}: ${current} → ${latest} = ${result ? 'INCLUDE' : 'EXCLUDE'}`)
    })
  })

  it('should identify why all updates are being excluded', () => {
    // Test the exact scenario from composer.json
    const composerScenarios = [
      { pkg: 'laravel/framework', constraint: '^10.0', current: '10.0.0', latest: '10.48.29' },
      { pkg: 'symfony/console', constraint: '^6.0', current: '6.0.0', latest: '6.4.23' },
      { pkg: 'monolog/monolog', constraint: '^3.0', current: '3.0.0', latest: '3.9.0' },
      { pkg: 'doctrine/dbal', constraint: '^3.0', current: '3.0.0', latest: '3.10.0' },
      { pkg: 'guzzlehttp/guzzle', constraint: '^7.0', current: '7.0.0', latest: '7.9.3' },
      { pkg: 'phpunit/phpunit', constraint: '^10.0', current: '10.0.0', latest: '10.5.48' },
      { pkg: 'mockery/mockery', constraint: '^1.5', current: '1.5.0', latest: '1.6.12' },
      { pkg: 'fakerphp/faker', constraint: '^1.20', current: '1.20.0', latest: '1.24.1' },
    ]

    let includedCount = 0
    let excludedCount = 0

    composerScenarios.forEach(({ pkg, constraint, current, latest }) => {
      const currentMajor = getMajorVersion(current)
      const latestMajor = getMajorVersion(latest)
      const result = shouldIncludeUpdate(constraint, current, latest)
      
      console.log(`${pkg}: ${constraint} | ${current} (major: ${currentMajor}) → ${latest} (major: ${latestMajor}) = ${result ? 'INCLUDE' : 'EXCLUDE'}`)
      
      if (result) {
        includedCount++
      } else {
        excludedCount++
      }
    })

    console.log(`\nTotal: ${includedCount} included, ${excludedCount} excluded`)
    
    // All of these should be included since they're minor updates within constraints
    expect(includedCount).toBe(8)
    expect(excludedCount).toBe(0)
  })
}) 