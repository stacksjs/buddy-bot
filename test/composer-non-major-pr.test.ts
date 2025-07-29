import type { UpdateGroup } from '../src/types'
import { beforeEach, describe, expect, it } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'

describe('Composer Non-Major PR', () => {
  let prGenerator: PullRequestGenerator

  beforeEach(() => {
    const mockConfig = {
      repository: {
        owner: 'test-owner',
        name: 'test-repo',
        baseBranch: 'main',
      },
    }
    prGenerator = new PullRequestGenerator()
  })

  it('should include Composer updates in non-major grouped PR', async () => {
    // Create a mixed non-major update group that includes Composer packages
    const nonMajorGroup: UpdateGroup = {
      name: 'Non-Major Updates',
      updates: [
        // npm packages
        {
          name: '@types/bun',
          currentVersion: '1.2.17',
          newVersion: '1.2.19',
          updateType: 'patch',
          dependencyType: 'devDependencies',
          file: 'package.json',
        },
        {
          name: 'cac',
          currentVersion: '6.7.13',
          newVersion: '6.7.14',
          updateType: 'patch',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
        // Composer packages (non-major)
        {
          name: 'monolog/monolog',
          currentVersion: '3.7.0',
          newVersion: '3.8.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
        },
        {
          name: 'phpunit/phpunit',
          currentVersion: '10.5.0',
          newVersion: '10.5.2',
          updateType: 'patch',
          dependencyType: 'require-dev',
          file: 'composer.json',
        },
        // GitHub Actions
        {
          name: 'actions/checkout',
          currentVersion: 'v4',
          newVersion: 'v4.2.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
      ],
      updateType: 'minor',
      title: 'chore(deps): update all non-major dependencies',
      body: '',
    }

    const prBody = await prGenerator.generateBody(nonMajorGroup)

    // Should include npm dependencies section
    expect(prBody).toContain('### npm Dependencies')
    expect(prBody).toContain('@types/bun')
    expect(prBody).toContain('cac')

    // Should include Composer dependencies section
    expect(prBody).toContain('### PHP/Composer Dependencies')
    expect(prBody).toContain('monolog/monolog')
    expect(prBody).toContain('phpunit/phpunit')

    // Should include GitHub Actions section
    expect(prBody).toContain('### GitHub Actions')
    expect(prBody).toContain('actions/checkout')

    // Verify Composer package links - they now go to homepage/source, not packagist
    expect(prBody).toContain('([source](https://redirect.github.com/Seldaek/monolog))')
    expect(prBody).toContain('([source](https://redirect.github.com/sebastianbergmann/phpunit))')

    // Verify constraint-style version changes in Composer section
    expect(prBody).toContain('`^3.7.0 -> ^3.8.0`')
    expect(prBody).toContain('`^10.5.0 -> ^10.5.2`')
  })

  it('should handle non-major PR with only Composer updates', async () => {
    // Test a non-major group with only Composer packages
    const composerOnlyGroup: UpdateGroup = {
      name: 'Non-Major Updates',
      updates: [
        {
          name: 'psr/log',
          currentVersion: '3.0.0',
          newVersion: '3.0.2',
          updateType: 'patch',
          dependencyType: 'require',
          file: 'composer.json',
        },
      ],
      updateType: 'patch',
      title: 'chore(deps): update all non-major dependencies',
      body: '',
    }

    const prBody = await prGenerator.generateBody(composerOnlyGroup)

    // Should only have Composer section
    expect(prBody).toContain('### PHP/Composer Dependencies')
    expect(prBody).toContain('psr/log')

    // Should NOT have npm or GitHub Actions sections
    expect(prBody).not.toContain('### npm Dependencies')
    expect(prBody).not.toContain('### GitHub Actions')
  })

  it('should show correct status for require vs require-dev packages', async () => {
    const mixedComposerGroup: UpdateGroup = {
      name: 'Non-Major Updates',
      updates: [
        {
          name: 'symfony/http-foundation',
          currentVersion: '6.4.0',
          newVersion: '6.4.12',
          updateType: 'patch',
          dependencyType: 'require',
          file: 'composer.json',
        },
        {
          name: 'phpstan/phpstan',
          currentVersion: '1.10.0',
          newVersion: '1.12.0',
          updateType: 'minor',
          dependencyType: 'require-dev',
          file: 'composer.json',
        },
      ],
      updateType: 'minor',
      title: 'chore(deps): update all non-major dependencies',
      body: '',
    }

    const prBody = await prGenerator.generateBody(mixedComposerGroup)

    // Both should appear in Composer section
    expect(prBody).toContain('symfony/http-foundation')
    expect(prBody).toContain('phpstan/phpstan')
    expect(prBody).toContain('### PHP/Composer Dependencies')

    // Should have the same format as npm dependencies (no file column)
    expect(prBody).toContain('| Package | Change | Age | Adoption | Passing | Confidence |')

    // Should have the same columns as npm dependencies
    expect(prBody).toContain('| Package | Change | Age | Adoption | Passing | Confidence |')
    expect(prBody).toContain('|---|---|---|---|---|---|')

    // Should have the new table format with dependency and update type columns
    expect(prBody).toContain('| Package | Change | Age | Adoption | Passing | Confidence | Type | Update |')
    expect(prBody).toContain('|---|---|---|---|---|---|---|---|')

    // Should show constraint-style changes for actual test packages
    expect(prBody).toContain('^6.4.0 -> ^6.4.12')
    expect(prBody).toContain('^1.10.0 -> ^1.12.0')

    // Should have confidence badges
    expect(prBody).toContain('[![age](https://developer.mend.io/api/mc/badges/age/packagist/')
    expect(prBody).toContain('[![adoption](https://developer.mend.io/api/mc/badges/adoption/packagist/')
    expect(prBody).toContain('[![passing](https://developer.mend.io/api/mc/badges/compatibility/packagist/')
    expect(prBody).toContain('[![confidence](https://developer.mend.io/api/mc/badges/confidence/packagist/')

    // Should show dependency types
    expect(prBody).toContain('require')
    expect(prBody).toContain('require-dev')
  })

  it('should deduplicate composer packages and show enhanced links', async () => {
    // Create a group with duplicate composer packages
    const duplicateComposerGroup: UpdateGroup = {
      name: 'Non-Major Updates',
      updates: [
        {
          name: 'monolog/monolog',
          currentVersion: '3.7.0',
          newVersion: '3.8.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
          metadata: {
            name: 'monolog/monolog',
            repository: 'https://github.com/Seldaek/monolog',
            description: 'Sends your logs to files, sockets, inboxes, databases and various web services',
            latestVersion: '3.8.0',
            versions: ['3.7.0', '3.8.0'],
          },
        },
        {
          name: 'monolog/monolog', // Duplicate package
          currentVersion: '3.7.0',
          newVersion: '3.8.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
          metadata: {
            name: 'monolog/monolog',
            repository: 'https://github.com/Seldaek/monolog',
            description: 'Sends your logs to files, sockets, inboxes, databases and various web services',
            latestVersion: '3.8.0',
            versions: ['3.7.0', '3.8.0'],
          },
        },
        {
          name: 'phpunit/phpunit',
          currentVersion: '10.5.0',
          newVersion: '10.5.2',
          updateType: 'patch',
          dependencyType: 'require-dev',
          file: 'composer.json',
        },
      ],
      updateType: 'minor',
      title: 'chore(deps): update all non-major dependencies',
      body: '',
    }

    const prBody = await prGenerator.generateBody(duplicateComposerGroup)

    // Should only show monolog/monolog once (deduplicated)
    const monologMatches = (prBody.match(/monolog\/monolog/g) || []).length
    // Should appear: table (1) + release notes (1) + package stats (1) + URLs (~1) = ~4 times total
    expect(monologMatches).toBeLessThanOrEqual(5) // Allow some flexibility for URLs

    // Should show enhanced link with source repository
    expect(prBody).toContain('https://packagist.org/packages/monolog%2Fmonolog')
    expect(prBody).toContain('([source](')
    expect(prBody).toContain('github.com/Seldaek/monolog')

    // Should still show phpunit
    expect(prBody).toContain('phpunit/phpunit')
  })

  it('should format links exactly like npm packages', async () => {
    const testGroup: UpdateGroup = {
      name: 'Non-Major Updates',
      updates: [
        {
          name: 'monolog/monolog',
          currentVersion: '3.7.0',
          newVersion: '3.8.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
          metadata: {
            name: 'monolog/monolog',
            repository: 'https://github.com/Seldaek/monolog',
            description: 'Sends your logs to files, sockets, inboxes, databases and various web services',
            latestVersion: '3.8.0',
            versions: ['3.7.0', '3.8.0'],
          },
        },
      ],
      updateType: 'minor',
      title: 'chore(deps): update all non-major dependencies',
      body: '',
    }

    const prBody = await prGenerator.generateBody(testGroup)

    // Should format like Renovate: [packageName](homepage) ([source](redirect.github.com))
    expect(prBody).toContain('[monolog/monolog](https://github.com/Seldaek/monolog) ([source](https://redirect.github.com/Seldaek/monolog))')

    // Should have the new table format with dependency and update type columns
    expect(prBody).toContain('| Package | Change | Age | Adoption | Passing | Confidence | Type | Update |')
    expect(prBody).toContain('|---|---|---|---|---|---|---|---|')

    // Should show constraint-style changes
    expect(prBody).toContain('^3.7.0 -> ^3.8.0')

    // Should have confidence badges with normalized versions
    expect(prBody).toContain('[![age](https://developer.mend.io/api/mc/badges/age/packagist/')
    expect(prBody).toContain('[![adoption](https://developer.mend.io/api/mc/badges/adoption/packagist/')
    expect(prBody).toContain('[![passing](https://developer.mend.io/api/mc/badges/compatibility/packagist/')
    expect(prBody).toContain('[![confidence](https://developer.mend.io/api/mc/badges/confidence/packagist/')

    // Should show dependency type
    expect(prBody).toContain('| require | minor |')
  })
})
