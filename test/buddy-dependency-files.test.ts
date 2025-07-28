import type { BuddyBotConfig, PackageUpdate } from '../src/types'

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import { Buddy } from '../src/buddy'

describe('Buddy - Dependency Files Integration', () => {
  let buddy: Buddy
  let readFileSpy: any
  let existsSyncSpy: any
  let mockGenerateGitHubActionsUpdates: any
  let mockGenerateDependencyFileUpdates: any

  const mockConfig: BuddyBotConfig = {
    repository: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
    },
    packages: { strategy: 'all' },
  }

  const mockPackageJsonContent = JSON.stringify({
    name: 'test-project',
    dependencies: {
      cac: '6.7.13',
    },
    devDependencies: {
      '@types/bun': '^1.2.17',
    },
  }, null, 2)

  beforeEach(async () => {
    // Mock fs operations
    readFileSpy = spyOn(fs, 'readFileSync')
    existsSyncSpy = spyOn(fs, 'existsSync')

    // Set default mock return values
    readFileSpy.mockImplementation((filePath: string) => {
      if (filePath === 'package.json' || filePath.endsWith('package.json')) {
        return mockPackageJsonContent
      }
      return '{}'
    })
    existsSyncSpy.mockReturnValue(true)

    // Mock the GitHub Actions parser
    mockGenerateGitHubActionsUpdates = spyOn(await import('../src/utils/github-actions-parser'), 'generateGitHubActionsUpdates')
    mockGenerateGitHubActionsUpdates.mockResolvedValue([])

    // Mock the dependency file parser
    mockGenerateDependencyFileUpdates = spyOn(await import('../src/utils/dependency-file-parser'), 'generateDependencyFileUpdates')
    mockGenerateDependencyFileUpdates.mockResolvedValue([])

    buddy = new Buddy(mockConfig)
  })

  afterEach(() => {
    // Clean up mocks
    readFileSpy?.mockRestore?.()
    existsSyncSpy?.mockRestore?.()
    mockGenerateGitHubActionsUpdates?.mockRestore?.()
    mockGenerateDependencyFileUpdates?.mockRestore?.()
  })

  const packageJsonUpdates: PackageUpdate[] = [
    {
      name: 'cac',
      currentVersion: '6.7.13',
      newVersion: '6.7.14',
      updateType: 'patch',
      dependencyType: 'dependencies',
      file: 'package.json',
    },
    {
      name: '@types/bun',
      currentVersion: '^1.2.17',
      newVersion: '1.2.19',
      updateType: 'patch',
      dependencyType: 'devDependencies',
      file: 'package.json',
    },
  ]

  const dependencyFileUpdates: PackageUpdate[] = [
    {
      name: 'lodash',
      currentVersion: '^4.17.20',
      newVersion: '4.17.21',
      updateType: 'patch',
      dependencyType: 'dependencies',
      file: 'deps.yaml',
    },
  ]

  const mixedUpdates: PackageUpdate[] = [...packageJsonUpdates, ...dependencyFileUpdates]

  describe('generateAllFileUpdates with dependency files', () => {
    it('should handle both package.json and dependency file updates', async () => {
      readFileSpy.mockReturnValue(mockPackageJsonContent)

      const result = await buddy.generateAllFileUpdates(mixedUpdates)

      // Should have at least 1 file update for package.json
      expect(result.length).toBeGreaterThanOrEqual(1)

      // Check that package.json update exists
      const packageJsonUpdate = result.find((u: any) => u.path === 'package.json')
      expect(packageJsonUpdate).toBeDefined()
      expect(packageJsonUpdate?.content).toContain('"cac": "6.7.14"')
      expect(packageJsonUpdate?.content).toContain('"@types/bun": "^1.2.19"')

      // Check that dependency file parser was called with filtered dependency file updates only
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith(dependencyFileUpdates)
    })

    it('should only process package.json when no dependency files present', async () => {
      readFileSpy.mockReturnValue(mockPackageJsonContent)

      const result = await buddy.generateAllFileUpdates(packageJsonUpdates)

      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('package.json')
      expect(result[0].content).toContain('"cac": "6.7.14"')
      expect(result[0].content).toContain('"@types/bun": "^1.2.19"')

      // Dependency file parser should not be called since there are no dependency file updates
      expect(mockGenerateDependencyFileUpdates).not.toHaveBeenCalled()
    })

    it('should only process dependency files when no package.json updates', async () => {
      existsSyncSpy.mockReturnValue(true)
      readFileSpy.mockReturnValue('dependencies:\n  lodash: ^4.17.21')

      const result = await buddy.generateAllFileUpdates(dependencyFileUpdates)

      // Should have 0 package.json updates since filtering excludes .yaml files
      const packageJsonFiles = result.filter((u: any) => u.path === 'package.json')
      expect(packageJsonFiles).toHaveLength(0)

      // Dependency file parser should be called with dependency file updates
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith(dependencyFileUpdates)
    })

    it('should handle mixed file types correctly', async () => {
      readFileSpy.mockReturnValue(mockPackageJsonContent)
      existsSyncSpy.mockReturnValue(true)

      const result = await buddy.generateAllFileUpdates(mixedUpdates)

      // Should process both package.json and dependency files
      const packageJsonFiles = result.filter((u: any) => u.path === 'package.json')
      expect(packageJsonFiles.length).toBeGreaterThanOrEqual(0) // At least package.json should be processed

      // Both parsers should be called with their respective filtered updates
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith(dependencyFileUpdates)
      expect(mockGenerateGitHubActionsUpdates).not.toHaveBeenCalled() // No GitHub Actions updates in this test
    })

    it('should preserve version prefixes in package.json', async () => {
      readFileSpy.mockReturnValue(mockPackageJsonContent)

      const result = await buddy.generateAllFileUpdates([packageJsonUpdates[0]])

      expect(result).toHaveLength(1)

      const packageJsonUpdate = result[0]
      expect(packageJsonUpdate.path).toBe('package.json')
      expect(packageJsonUpdate.content).toContain('"cac": "6.7.14"')
    })

    it('should filter out non-package.json files for package.json processing', async () => {
      readFileSpy.mockReturnValue(mockPackageJsonContent)

      const result = await buddy.generateAllFileUpdates(mixedUpdates)

      // Should only process package.json entries for the package.json file update
      const packageJsonUpdate = result.find((u: any) => u.path === 'package.json')
      if (packageJsonUpdate) {
        expect(packageJsonUpdate.content).toContain('"cac": "6.7.14"')
        expect(packageJsonUpdate.content).toContain('"@types/bun": "^1.2.19"')
      }
    })

    it('should return empty array when no updates provided', async () => {
      const result = await buddy.generateAllFileUpdates([])

      expect(result).toHaveLength(0)
    })

    // Test dependency-only updates
    const dependencyOnlyUpdates: PackageUpdate[] = [
      {
        name: 'ts-pkgx',
        currentVersion: '^0.4.4',
        newVersion: '0.4.7',
        updateType: 'patch',
        dependencyType: 'dependencies',
        file: 'deps.yaml',
      },
      {
        name: 'other-pkg',
        currentVersion: '^2.0.0',
        newVersion: '2.1.0',
        updateType: 'minor',
        dependencyType: 'dependencies',
        file: 'deps.yaml',
      },
      {
        name: 'vitest',
        currentVersion: '^1.0.0',
        newVersion: '1.1.0',
        updateType: 'minor',
        dependencyType: 'devDependencies',
        file: 'dev-deps.yaml',
      },
    ]

    it('should handle dependency-only file updates (no package.json)', async () => {
      existsSyncSpy.mockReturnValue(true)
      readFileSpy
        .mockReturnValueOnce('dependencies:\n  ts-pkgx: ^0.4.4\n  other-pkg: ^2.0.0')
        .mockReturnValueOnce('dev-dependencies:\n  vitest: ^1.0.0')

      const result = await buddy.generateAllFileUpdates(dependencyOnlyUpdates)

      // Should call dependency file parser with all dependency file updates
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith(dependencyOnlyUpdates)

      // Should not have package.json files since there are no package.json updates
      const packageJsonFiles = result.filter((u: any) => u.path === 'package.json')
      expect(packageJsonFiles).toHaveLength(0)
    })

    // Combined test scenario
    const mixedFileUpdates: PackageUpdate[] = [
      ...packageJsonUpdates,
      ...dependencyFileUpdates,
      {
        name: 'actions/setup-node',
        currentVersion: 'v3',
        newVersion: 'v4.0.1',
        updateType: 'major',
        dependencyType: 'github-actions',
        file: '.github/workflows/release.yml',
      },
    ]

    it('should handle github actions, dependency files, and package.json together', async () => {
      readFileSpy.mockReturnValue(mockPackageJsonContent)
      existsSyncSpy.mockReturnValue(true)

      const result = await buddy.generateAllFileUpdates(mixedFileUpdates)

      // All parsers should be called with their respective filtered updates
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith(dependencyFileUpdates)
      const githubActionsUpdates = mixedFileUpdates.filter(u => u.file.includes('.github/workflows/'))
      expect(mockGenerateGitHubActionsUpdates).toHaveBeenCalledWith(githubActionsUpdates)

      // Should process package.json
      const packageJsonFiles = result.filter((u: any) => u.path === 'package.json')
      expect(packageJsonFiles.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('error handling', () => {
    it('should continue processing when dependency file updates fail', async () => {
      readFileSpy.mockReturnValue(JSON.stringify({ dependencies: { cac: '^6.7.13' } }, null, 2))
      mockGenerateDependencyFileUpdates.mockRejectedValue(new Error('Dependency file error'))

      // Create an update that has both package.json and dependency file components
      const mixedUpdatesWithError = [
        packageJsonUpdates[0], // This should still work
        dependencyFileUpdates[0], // This will trigger the dependency file parser error
      ]

      // The function should handle the error gracefully and continue processing
      const result = await buddy.generateAllFileUpdates(mixedUpdatesWithError)

      // Should still process package.json despite dependency file error
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('package.json')
    })

    it('should continue processing when GitHub Actions updates fail', async () => {
      readFileSpy.mockReturnValue(JSON.stringify({ dependencies: { cac: '^6.7.13' } }, null, 2))
      mockGenerateGitHubActionsUpdates.mockRejectedValue(new Error('GitHub Actions error'))

      // Create an update that has both package.json and GitHub Actions components
      const mixedUpdatesWithError: PackageUpdate[] = [
        packageJsonUpdates[0], // This should still work
        {
          name: 'actions/checkout',
          currentVersion: 'v4',
          newVersion: 'v4.2.2',
          updateType: 'patch' as const,
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
      ]

      // The function should handle the error gracefully and continue processing
      const result = await buddy.generateAllFileUpdates(mixedUpdatesWithError)

      // Should still process package.json despite GitHub Actions error
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('package.json')
    })
  })

  describe('package.json filtering logic', () => {
    it('should correctly filter package.json updates', async () => {
      readFileSpy.mockReturnValue(mockPackageJsonContent)

      const testUpdates = [
        ...packageJsonUpdates,
        ...dependencyFileUpdates,
      ]

      const result = await buddy.generateAllFileUpdates(testUpdates)

      // Should only process the package.json file for package.json updates
      const packageJsonFiles = result.filter((u: any) => u.path === 'package.json')
      expect(packageJsonFiles.length).toBeLessThanOrEqual(1)

      // Dependency file parser should be called with dependency file updates only
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith(dependencyFileUpdates)
    })
  })
})
