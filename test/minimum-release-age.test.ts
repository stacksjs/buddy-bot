import type { BuddyBotConfig, PackageUpdate } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { Buddy } from '../src/buddy'
import { RegistryClient } from '../src/registry/registry-client'
import { Logger } from '../src/utils/logger'

describe('Minimum Release Age Functionality', () => {
  let testDir: string
  let logger: Logger

  beforeEach(() => {
    // Create temporary test directory
    // eslint-disable-next-line ts/no-require-imports
    testDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'buddy-test-'))
    logger = new Logger(false)

    // Ensure the directory is clean
    const files = fs.readdirSync(testDir)
    if (files.length > 0) {
      files.forEach(file => fs.rmSync(path.join(testDir, file), { recursive: true, force: true }))
    }
  })

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('RegistryClient.meetsMinimumReleaseAge', () => {
    it('should allow all packages when minimumReleaseAge is 0 (default)', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 0,
        },
      }

      const registryClient = new RegistryClient(testDir, logger, config)

      // Should allow any package regardless of release date
      const result = await registryClient.meetsMinimumReleaseAge('react', '18.0.0', 'dependencies')
      expect(result).toBe(true)
    })

    it('should allow packages in exclude list regardless of age', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 1440, // 24 hours
          minimumReleaseAgeExclude: ['react', 'webpack'],
        },
      }

      const registryClient = new RegistryClient(testDir, logger, config)

      // Should allow excluded packages
      const reactResult = await registryClient.meetsMinimumReleaseAge('react', '18.0.0', 'dependencies')
      expect(reactResult).toBe(true)

      const webpackResult = await registryClient.meetsMinimumReleaseAge('webpack', '5.0.0', 'devDependencies')
      expect(webpackResult).toBe(true)
    })

    it('should handle npm/bun packages with mocked release dates', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 60, // 1 hour
        },
      }

      const registryClient = new RegistryClient(testDir, logger, config)

      // Mock the getPackageVersionReleaseDate method
      const originalMethod = registryClient.getPackageVersionReleaseDate
      registryClient.getPackageVersionReleaseDate = mock(async (packageName: string, _version: string) => {
        if (packageName === 'old-package') {
          // Package released 2 hours ago (should pass)
          return new Date(Date.now() - 2 * 60 * 60 * 1000)
        }
        if (packageName === 'new-package') {
          // Package released 30 minutes ago (should fail)
          return new Date(Date.now() - 30 * 60 * 1000)
        }
        return null
      })

      // Old package should pass
      const oldResult = await registryClient.meetsMinimumReleaseAge('old-package', '1.0.0', 'dependencies')
      expect(oldResult).toBe(true)

      // New package should fail
      const newResult = await registryClient.meetsMinimumReleaseAge('new-package', '1.0.0', 'dependencies')
      expect(newResult).toBe(false)

      // Restore original method
      registryClient.getPackageVersionReleaseDate = originalMethod
    })

    it('should handle GitHub Actions with mocked release dates', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 120, // 2 hours
        },
      }

      const registryClient = new RegistryClient(testDir, logger, config)

      // Mock the getGitHubActionReleaseDate method
      const originalMethod = registryClient.getGitHubActionReleaseDate
      registryClient.getGitHubActionReleaseDate = mock(async (actionName: string, version: string) => {
        if (actionName === 'actions/checkout' && version === 'v4') {
          // Action released 3 hours ago (should pass)
          return new Date(Date.now() - 3 * 60 * 60 * 1000)
        }
        if (actionName === 'actions/setup-node' && version === 'v5') {
          // Action released 1 hour ago (should fail)
          return new Date(Date.now() - 1 * 60 * 60 * 1000)
        }
        return null
      })

      // Old action should pass
      const oldResult = await registryClient.meetsMinimumReleaseAge('actions/checkout', 'v4', 'github-actions')
      expect(oldResult).toBe(true)

      // New action should fail
      const newResult = await registryClient.meetsMinimumReleaseAge('actions/setup-node', 'v5', 'github-actions')
      expect(newResult).toBe(false)

      // Restore original method
      registryClient.getGitHubActionReleaseDate = originalMethod
    })

    it('should handle Composer packages with mocked release dates', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 30, // 30 minutes
        },
      }

      const registryClient = new RegistryClient(testDir, logger, config)

      // Mock the getComposerPackageReleaseDate method
      const originalMethod = registryClient.getComposerPackageReleaseDate
      registryClient.getComposerPackageReleaseDate = mock(async (packageName: string, version: string) => {
        if (packageName === 'laravel/framework' && version === '10.0.0') {
          // Package released 1 hour ago (should pass)
          return new Date(Date.now() - 60 * 60 * 1000)
        }
        if (packageName === 'symfony/console' && version === '6.0.0') {
          // Package released 15 minutes ago (should fail)
          return new Date(Date.now() - 15 * 60 * 1000)
        }
        return null
      })

      // Old package should pass
      const oldResult = await registryClient.meetsMinimumReleaseAge('laravel/framework', '10.0.0', 'require')
      expect(oldResult).toBe(true)

      // New package should fail
      const newResult = await registryClient.meetsMinimumReleaseAge('symfony/console', '6.0.0', 'require-dev')
      expect(newResult).toBe(false)

      // Restore original method
      registryClient.getComposerPackageReleaseDate = originalMethod
    })

    it('should allow updates when release date cannot be determined', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 60,
        },
      }

      const registryClient = new RegistryClient(testDir, logger, config)

      // Mock methods to return null (can't determine release date)
      registryClient.getPackageVersionReleaseDate = mock(async () => null)
      registryClient.getGitHubActionReleaseDate = mock(async () => null)
      registryClient.getComposerPackageReleaseDate = mock(async () => null)

      // Should allow updates when release date is unknown (conservative approach)
      const npmResult = await registryClient.meetsMinimumReleaseAge('unknown-package', '1.0.0', 'dependencies')
      expect(npmResult).toBe(true)

      const actionResult = await registryClient.meetsMinimumReleaseAge('unknown/action', 'v1', 'github-actions')
      expect(actionResult).toBe(true)

      const composerResult = await registryClient.meetsMinimumReleaseAge('unknown/package', '1.0.0', 'require')
      expect(composerResult).toBe(true)
    })
  })

  describe('Buddy.filterUpdatesByMinimumReleaseAge', () => {
    it('should filter updates based on minimum release age', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 60, // 1 hour
          minimumReleaseAgeExclude: ['trusted-package'],
        },
      }

      const buddy = new Buddy(config, testDir)

      // Mock the registry client's meetsMinimumReleaseAge method
      const originalMethod = buddy.registryClient.meetsMinimumReleaseAge
      buddy.registryClient.meetsMinimumReleaseAge = mock(async (packageName: string, _version: string, _dependencyType?: string) => {
        // Simulate different packages with different ages
        if (packageName === 'old-package')
          return true
        if (packageName === 'new-package')
          return false
        if (packageName === 'trusted-package')
          return true // Should be excluded anyway
        return true
      })

      const mockUpdates: PackageUpdate[] = [
        {
          name: 'old-package',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
        {
          name: 'new-package',
          currentVersion: '2.0.0',
          newVersion: '2.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
        {
          name: 'trusted-package',
          currentVersion: '3.0.0',
          newVersion: '3.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
      ]

      // Call the private method using bracket notation
      const filteredUpdates = await buddy.filterUpdatesByMinimumReleaseAge(mockUpdates)

      // Should only include old-package and trusted-package
      expect(filteredUpdates).toHaveLength(2)
      expect(filteredUpdates.map(u => u.name)).toEqual(['old-package', 'trusted-package'])

      // Restore original method
      buddy.registryClient.meetsMinimumReleaseAge = originalMethod
    })

    it('should return all updates when minimumReleaseAge is 0', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 0, // Disabled
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockUpdates: PackageUpdate[] = [
        {
          name: 'package1',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
        {
          name: 'package2',
          currentVersion: '2.0.0',
          newVersion: '2.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
      ]

      const filteredUpdates = await buddy.filterUpdatesByMinimumReleaseAge(mockUpdates)

      // Should return all updates when disabled
      expect(filteredUpdates).toHaveLength(2)
      expect(filteredUpdates).toEqual(mockUpdates)
    })

    it('should handle mixed dependency types correctly', async () => {
      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 30, // 30 minutes
        },
      }

      const buddy = new Buddy(config, testDir)

      // Mock the registry client to simulate different behaviors for different types
      buddy.registryClient.meetsMinimumReleaseAge = mock(async (packageName: string, version: string, dependencyType?: string) => {
        // Simulate that npm packages are too new, but GitHub Actions are old enough
        if (dependencyType === 'dependencies')
          return false
        if (dependencyType === 'github-actions')
          return true
        if (dependencyType === 'require')
          return true
        return true
      })

      const mockUpdates: PackageUpdate[] = [
        {
          name: 'react',
          currentVersion: '17.0.0',
          newVersion: '18.0.0',
          updateType: 'major',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
        {
          name: 'actions/checkout',
          currentVersion: 'v3',
          newVersion: 'v4',
          updateType: 'major',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'laravel/framework',
          currentVersion: '9.0.0',
          newVersion: '10.0.0',
          updateType: 'major',
          dependencyType: 'require',
          file: 'composer.json',
        },
      ]

      const filteredUpdates = await buddy.filterUpdatesByMinimumReleaseAge(mockUpdates)

      // Should only include GitHub Actions and Composer packages
      expect(filteredUpdates).toHaveLength(2)
      expect(filteredUpdates.map(u => u.name)).toEqual(['actions/checkout', 'laravel/framework'])
    })
  })

  describe('Integration with scanForUpdates', () => {
    it('should apply minimum release age filtering in the main scan workflow', async () => {
      // Create a test package.json
      const packageJsonPath = path.join(testDir, 'package.json')
      fs.writeFileSync(packageJsonPath, JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          react: '^17.0.0',
        },
        devDependencies: {
          typescript: '^4.0.0',
        },
      }, null, 2))

      const config: BuddyBotConfig = {
        packages: {
          strategy: 'all',
          minimumReleaseAge: 60, // 1 hour
        },
      }

      const buddy = new Buddy(config, testDir)

      // Mock the registry client methods to avoid actual network calls
      buddy.registryClient.getOutdatedPackages = mock(async () => [
        {
          name: 'react',
          currentVersion: '17.0.0',
          newVersion: '18.0.0',
          updateType: 'major' as const,
          dependencyType: 'dependencies' as const,
          file: 'package.json',
        },
        {
          name: 'typescript',
          currentVersion: '4.0.0',
          newVersion: '5.0.0',
          updateType: 'major' as const,
          dependencyType: 'devDependencies' as const,
          file: 'package.json',
        },
      ])

      // Mock other update checking methods to return empty arrays
      buddy.checkDependencyFilesForUpdates = mock(async () => [])
      buddy.checkGitHubActionsForUpdates = mock(async () => [])
      buddy.checkDockerfilesForUpdates = mock(async () => [])

      // Mock minimum release age checking
      buddy.registryClient.meetsMinimumReleaseAge = mock(async (packageName: string) => {
        // Only allow typescript (simulate react being too new)
        return packageName === 'typescript'
      })

      const scanResult = await buddy.scanForUpdates()

      // Should only include typescript update (react filtered out)
      expect(scanResult.updates).toHaveLength(1)
      expect(scanResult.updates[0].name).toBe('typescript')
    })
  })
})
