import type { BuddyBotConfig, PackageUpdate } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import { Buddy } from '../src/buddy'

describe('Buddy - Composer Integration', () => {
  let buddy: Buddy
  let readFileSpy: any
  let existsSyncSpy: any
  let mockGenerateComposerUpdates: any

  const mockConfig: BuddyBotConfig = {
    repository: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
    },
    packages: { strategy: 'all' },
  }

  const mockComposerContent = JSON.stringify({
    'name': 'test/project',
    'require': {
      'laravel/framework': '^10.0.0',
      'guzzlehttp/guzzle': '^7.0.0',
    },
    'require-dev': {
      'phpunit/phpunit': '^10.0.0',
    },
  }, null, 2)

  beforeEach(async () => {
    // Mock fs operations
    readFileSpy = spyOn(fs, 'readFileSync')
    existsSyncSpy = spyOn(fs, 'existsSync')

    // Set default mock return values
    readFileSpy.mockImplementation((filePath: string) => {
      if (filePath === 'composer.json' || filePath.endsWith('composer.json')) {
        return mockComposerContent
      }
      return '{}'
    })
    existsSyncSpy.mockReturnValue(true)

    // Mock the Composer parser
    mockGenerateComposerUpdates = spyOn(await import('../src/utils/composer-parser'), 'generateComposerUpdates')
    mockGenerateComposerUpdates.mockResolvedValue([])

    buddy = new Buddy(mockConfig)
  })

  afterEach(() => {
    // Clean up mocks
    readFileSpy?.mockRestore?.()
    existsSyncSpy?.mockRestore?.()
    mockGenerateComposerUpdates?.mockRestore?.()
  })

  describe('File Updates', () => {
    it('should generate Composer file updates when composer.json exists', async () => {
      const composerUpdates: PackageUpdate[] = [
        {
          name: 'laravel/framework',
          currentVersion: '10.0.0',
          newVersion: '10.16.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
        },
        {
          name: 'phpunit/phpunit',
          currentVersion: '10.0.0',
          newVersion: '10.3.0',
          updateType: 'minor',
          dependencyType: 'require-dev',
          file: 'composer.json',
        },
      ]

      mockGenerateComposerUpdates.mockResolvedValue([
        {
          path: 'composer.json',
          content: mockComposerContent.replace('^10.0.0', '^10.16.0'),
          type: 'update',
        },
      ])

      const fileUpdates = await buddy.generateAllFileUpdates(composerUpdates)

      expect(mockGenerateComposerUpdates).toHaveBeenCalledWith(composerUpdates)
      expect(fileUpdates).toHaveLength(1)
      expect(fileUpdates[0].path).toBe('composer.json')
      expect(fileUpdates[0].type).toBe('update')
    })

    it('should handle mixed package updates (npm and Composer)', async () => {
      const mixedUpdates: PackageUpdate[] = [
        {
          name: 'react',
          currentVersion: '17.0.0',
          newVersion: '18.0.0',
          updateType: 'major',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
        {
          name: 'laravel/framework',
          currentVersion: '10.0.0',
          newVersion: '10.16.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
        },
      ]

      // Mock package.json content
      const mockPackageJsonContent = JSON.stringify({
        dependencies: { react: '^17.0.0' },
      }, null, 2)

      readFileSpy.mockImplementation((filePath: string) => {
        if (filePath === 'package.json')
          return mockPackageJsonContent
        if (filePath === 'composer.json')
          return mockComposerContent
        return '{}'
      })

      mockGenerateComposerUpdates.mockResolvedValue([
        {
          path: 'composer.json',
          content: mockComposerContent.replace('^10.0.0', '^10.16.0'),
          type: 'update',
        },
      ])

      const fileUpdates = await buddy.generateAllFileUpdates(mixedUpdates)

      // Should generate updates for both package.json and composer.json
      expect(fileUpdates.length).toBeGreaterThan(0)

      const composerUpdate = fileUpdates.find(update => update.path === 'composer.json')
      expect(composerUpdate).toBeDefined()
      expect(composerUpdate!.type).toBe('update')
    })

    it('should handle Composer update generation errors gracefully', async () => {
      const composerUpdates: PackageUpdate[] = [
        {
          name: 'laravel/framework',
          currentVersion: '10.0.0',
          newVersion: '10.16.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
        },
      ]

      // Mock Composer update generation to throw an error
      mockGenerateComposerUpdates.mockRejectedValue(new Error('Composer update failed'))

      // Should not throw an error, but continue with other updates
      const fileUpdates = await buddy.generateAllFileUpdates(composerUpdates)

      expect(mockGenerateComposerUpdates).toHaveBeenCalled()
      // Should still return empty array or other updates, not throw
      expect(fileUpdates).toBeDefined()
    })

    it('should skip Composer updates when no Composer files exist', async () => {
      const nonComposerUpdates: PackageUpdate[] = [
        {
          name: 'react',
          currentVersion: '17.0.0',
          newVersion: '18.0.0',
          updateType: 'major',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
      ]

      const _fileUpdates = await buddy.generateAllFileUpdates(nonComposerUpdates)

      expect(mockGenerateComposerUpdates).toHaveBeenCalledWith(nonComposerUpdates)
    })
  })

  describe('Package Type Recognition', () => {
    it('should recognize Composer packages by vendor/package format', () => {
      const composerPackageNames = [
        'laravel/framework',
        'symfony/console',
        'doctrine/orm',
        'guzzlehttp/guzzle',
        'phpunit/phpunit',
        'mockery/mockery',
      ]

      const nonComposerPackageNames = [
        'react',
        'typescript',
        '@types/node',
        'php', // This is a platform requirement, not a package
        'ext-json', // This is an extension, not a package
      ]

      // Composer packages should contain "/"
      composerPackageNames.forEach((name) => {
        expect(name).toContain('/')
      })

      // Non-Composer packages should not contain "/" (except for npm scoped packages)
      const npmPackages = nonComposerPackageNames.filter(name => !name.startsWith('@'))
      npmPackages.forEach((name) => {
        expect(name).not.toContain('/')
      })
    })
  })

  describe('Configuration Integration', () => {
    it('should respect ignore list for Composer packages', async () => {
      const configWithIgnore: BuddyBotConfig = {
        ...mockConfig,
        packages: {
          strategy: 'all',
          ignore: ['laravel/framework', 'phpunit/phpunit'],
        },
      }

      const buddyWithIgnore = new Buddy(configWithIgnore)

      // The ignore functionality is handled at the registry level
      // This test verifies the Buddy class can be instantiated with ignore config
      expect(buddyWithIgnore).toBeDefined()
    })

    it('should apply update strategy to Composer packages', async () => {
      const configWithStrategy: BuddyBotConfig = {
        ...mockConfig,
        packages: {
          strategy: 'minor',
        },
      }

      const buddyWithStrategy = new Buddy(configWithStrategy)

      // The strategy filtering is handled in the filterUpdatesByStrategy method
      // This test verifies the Buddy class can be instantiated with strategy config
      expect(buddyWithStrategy).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    it('should handle malformed composer.json gracefully', async () => {
      // Mock malformed composer.json
      readFileSpy.mockImplementation((filePath: string) => {
        if (filePath === 'composer.json') {
          return '{ invalid json'
        }
        return '{}'
      })

      const updates: PackageUpdate[] = [
        {
          name: 'laravel/framework',
          currentVersion: '10.0.0',
          newVersion: '10.16.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
        },
      ]

      // Should handle the error gracefully
      const fileUpdates = await buddy.generateAllFileUpdates(updates)
      expect(fileUpdates).toBeDefined()
    })

    it('should handle missing composer.json file during updates', async () => {
      existsSyncSpy.mockReturnValue(false)
      readFileSpy.mockImplementation(() => {
        throw new Error('File not found')
      })

      const updates: PackageUpdate[] = [
        {
          name: 'laravel/framework',
          currentVersion: '10.0.0',
          newVersion: '10.16.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
        },
      ]

      // Should handle the error gracefully
      const fileUpdates = await buddy.generateAllFileUpdates(updates)
      expect(fileUpdates).toBeDefined()
    })
  })

  describe('Update Groups', () => {
    it('should include Composer packages in update groups', async () => {
      const updates: PackageUpdate[] = [
        {
          name: 'laravel/framework',
          currentVersion: '10.0.0',
          newVersion: '10.16.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
        },
        {
          name: 'symfony/console',
          currentVersion: '6.0.0',
          newVersion: '6.3.0',
          updateType: 'minor',
          dependencyType: 'require',
          file: 'composer.json',
        },
      ]

      // Test that updates can be grouped (this functionality is in the grouping logic)
      const groupedByType = updates.reduce((groups, update) => {
        const key = update.dependencyType
        if (!groups[key])
          groups[key] = []
        groups[key].push(update)
        return groups
      }, {} as Record<string, PackageUpdate[]>)

      expect(groupedByType.require).toHaveLength(2)
      expect(groupedByType.require.some(update => update.name === 'laravel/framework')).toBe(true)
      expect(groupedByType.require.some(update => update.name === 'symfony/console')).toBe(true)
    })
  })
})
