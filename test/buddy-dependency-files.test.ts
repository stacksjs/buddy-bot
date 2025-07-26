import type { BuddyBotConfig, PackageUpdate } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import fs from 'node:fs'

// Import Buddy AFTER mocks are set up
import { Buddy } from '../src/buddy'

// Import for spying
import * as dependencyFileParser from '../src/utils/dependency-file-parser'

// Create spies instead of global mocks
const mockReadFileSync = mock()
const mockExistsSync = mock()

// Create mock
const mockGenerateDependencyFileUpdates = mock()

// Mock package scanner
const mockScanProject = mock()
mock.module('../src/scanner/package-scanner', () => ({
  PackageScanner: class MockPackageScanner {
    scanProject = mockScanProject
  },
}))

// Mock registry client
const mockGetOutdatedPackages = mock()
mock.module('../src/registry/registry-client', () => ({
  RegistryClient: class MockRegistryClient {
    getOutdatedPackages = mockGetOutdatedPackages
  },
}))

describe('Buddy - Dependency Files Integration', () => {
  let buddy: Buddy
  let readFileSyncSpy: any
  let existsSyncSpy: any
  let generateDependencyFileUpdatesSpy: any

  const mockConfig: BuddyBotConfig = {
    verbose: false,
    packages: { strategy: 'all' },
    repository: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
      token: 'test-token',
    },
  }

  beforeEach(() => {
    // Setup spies on fs methods
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation(mockReadFileSync)
    existsSyncSpy = spyOn(fs, 'existsSync').mockImplementation(mockExistsSync)

    // Setup spy on dependency file parser
    generateDependencyFileUpdatesSpy = spyOn(dependencyFileParser, 'generateDependencyFileUpdates').mockImplementation(mockGenerateDependencyFileUpdates)

    buddy = new Buddy(mockConfig)

    // Reset all mocks
    mockReadFileSync.mockReset()
    mockExistsSync.mockReset()
    mockGenerateDependencyFileUpdates.mockReset()
    mockScanProject.mockReset()
    mockGetOutdatedPackages.mockReset()
  })

  afterEach(() => {
    // Restore spies
    readFileSyncSpy?.mockRestore()
    existsSyncSpy?.mockRestore()
    generateDependencyFileUpdatesSpy?.mockRestore()

    // Clear all mocks
    mockReadFileSync.mockClear()
    mockExistsSync.mockClear()
    mockGenerateDependencyFileUpdates.mockClear()
    mockScanProject.mockClear()
    mockGetOutdatedPackages.mockClear()
  })

  describe('generatePackageJsonUpdates with dependency files', () => {
    const mockPackageJsonContent = JSON.stringify({
      name: 'test-project',
      dependencies: {
        lodash: '^4.17.21',
        react: '^18.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
      },
    }, null, 2)

    const packageJsonUpdates: PackageUpdate[] = [
      {
        name: 'lodash',
        currentVersion: '^4.17.21',
        newVersion: '4.17.22',
        updateType: 'patch',
        dependencyType: 'dependencies',
        file: 'package.json',
      },
      {
        name: 'typescript',
        currentVersion: '^5.0.0',
        newVersion: '5.1.0',
        updateType: 'minor',
        dependencyType: 'devDependencies',
        file: 'package.json',
      },
    ]

    const dependencyFileUpdates: PackageUpdate[] = [
      {
        name: 'eslint',
        currentVersion: '^8.0.0',
        newVersion: '8.1.0',
        updateType: 'minor',
        dependencyType: 'dependencies',
        file: 'deps.yaml',
      },
      {
        name: 'prettier',
        currentVersion: '^2.8.0',
        newVersion: '2.8.1',
        updateType: 'patch',
        dependencyType: 'dependencies',
        file: 'dependencies.yml',
      },
    ]

    const mixedUpdates = [...packageJsonUpdates, ...dependencyFileUpdates]

    beforeEach(() => {
      // Setup specific mocks for package.json reading
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === 'package.json') {
          return mockPackageJsonContent
        }
        // Return empty string for other files to avoid errors
        return ''
      })
      mockExistsSync.mockReturnValue(true)
    })

    it('should generate updates for both package.json and dependency files', async () => {
      const expectedDependencyFileUpdates = [
        {
          path: 'deps.yaml',
          content: 'updated deps.yaml content',
          type: 'update',
        },
        {
          path: 'dependencies.yml',
          content: 'updated dependencies.yml content',
          type: 'update',
        },
      ]

      mockGenerateDependencyFileUpdates.mockResolvedValue(expectedDependencyFileUpdates)

      const result = await buddy.generatePackageJsonUpdates(mixedUpdates)

      expect(result).toHaveLength(3) // 1 package.json + 2 dependency files

      // Check package.json update
      const packageJsonUpdate = result.find(u => u.path === 'package.json')
      expect(packageJsonUpdate).toBeDefined()
      expect(packageJsonUpdate?.content).toContain('"lodash": "^4.17.22"')
      expect(packageJsonUpdate?.content).toContain('"typescript": "^5.1.0"')
      expect(packageJsonUpdate?.type).toBe('update')

      // Check dependency file updates
      const depsYamlUpdate = result.find(u => u.path === 'deps.yaml')
      const dependenciesYmlUpdate = result.find(u => u.path === 'dependencies.yml')

      expect(depsYamlUpdate).toBeDefined()
      expect(depsYamlUpdate?.content).toBe('updated deps.yaml content')

      expect(dependenciesYmlUpdate).toBeDefined()
      expect(dependenciesYmlUpdate?.content).toBe('updated dependencies.yml content')

      // Verify dependency file generator was called with correct updates
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith(mixedUpdates)
    })

    it('should handle only package.json updates', async () => {
      mockGenerateDependencyFileUpdates.mockResolvedValue([])

      const result = await buddy.generatePackageJsonUpdates(packageJsonUpdates)

      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('package.json')
      expect(result[0].content).toContain('"lodash": "^4.17.22"')
      expect(result[0].content).toContain('"typescript": "^5.1.0"')
    })

    it('should handle only dependency file updates', async () => {
      const expectedDependencyFileUpdates = [
        {
          path: 'deps.yaml',
          content: 'updated deps.yaml content',
          type: 'update',
        },
      ]

      mockGenerateDependencyFileUpdates.mockResolvedValue(expectedDependencyFileUpdates)

      const result = await buddy.generatePackageJsonUpdates(dependencyFileUpdates)

      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('deps.yaml')
      expect(result[0].content).toBe('updated deps.yaml content')

      // Verify no package.json update was generated
      expect(result.find(u => u.path === 'package.json')).toBeUndefined()
    })

    it('should correctly filter package.json vs dependency file updates', async () => {
      mockGenerateDependencyFileUpdates.mockResolvedValue([
        {
          path: 'deps.yaml',
          content: 'updated content',
          type: 'update',
        },
      ])

      const result = await buddy.generatePackageJsonUpdates(mixedUpdates)

      // Verify the dependency file generator was called with all updates
      // (it will internally filter for dependency files)
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith(mixedUpdates)

      // Verify package.json update only includes package.json updates
      const packageJsonUpdate = result.find(u => u.path === 'package.json')
      expect(packageJsonUpdate?.content).toContain('"lodash": "^4.17.22"')
      expect(packageJsonUpdate?.content).toContain('"typescript": "^5.1.0"')
      // Should not contain dependency file packages
      expect(packageJsonUpdate?.content).not.toContain('eslint')
      expect(packageJsonUpdate?.content).not.toContain('prettier')
    })

    it('should preserve package.json formatting', async () => {
      const formattedPackageJson = JSON.stringify({
        name: 'test-project',
        dependencies: {
          lodash: '^4.17.21',
        },
      }, null, 4) // 4 spaces indentation

      mockReadFileSync.mockReturnValue(formattedPackageJson)
      mockGenerateDependencyFileUpdates.mockResolvedValue([])

      const result = await buddy.generatePackageJsonUpdates([packageJsonUpdates[0]])

      expect(result).toHaveLength(1)
      const content = result[0].content

      // Should preserve the original 4-space indentation
      expect(content).toContain('    "lodash": "^4.17.22"')
    })

    it('should handle dependency file generator errors gracefully', async () => {
      mockGenerateDependencyFileUpdates.mockRejectedValue(new Error('Failed to generate dependency file updates'))

      const result = await buddy.generatePackageJsonUpdates(mixedUpdates)

      // Should still include package.json update
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('package.json')
      expect(result[0].content).toContain('"lodash": "^4.17.22"')
    })

    it('should handle empty updates array', async () => {
      mockGenerateDependencyFileUpdates.mockResolvedValue([])

      const result = await buddy.generatePackageJsonUpdates([])

      expect(result).toHaveLength(0)
      expect(mockGenerateDependencyFileUpdates).toHaveBeenCalledWith([])
    })

    it('should handle updates with no package.json changes', async () => {
      const dependencyOnlyUpdates: PackageUpdate[] = [
        {
          name: 'some-tool',
          currentVersion: '^1.0.0',
          newVersion: '1.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
      ]

      mockGenerateDependencyFileUpdates.mockResolvedValue([
        {
          path: 'deps.yaml',
          content: 'updated content',
          type: 'update',
        },
      ])

      const result = await buddy.generatePackageJsonUpdates(dependencyOnlyUpdates)

      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('deps.yaml')

      // Verify package.json was not read or modified
      expect(mockReadFileSync).not.toHaveBeenCalled()
    })

    it('should handle updates with mixed file extensions', async () => {
      const mixedFileUpdates: PackageUpdate[] = [
        {
          name: 'lodash',
          currentVersion: '^4.17.21',
          newVersion: '4.17.22',
          updateType: 'patch',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
        {
          name: 'eslint',
          currentVersion: '^8.0.0',
          newVersion: '8.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
        {
          name: 'prettier',
          currentVersion: '^2.8.0',
          newVersion: '2.8.1',
          updateType: 'patch',
          dependencyType: 'dependencies',
          file: 'dependencies.yml',
        },
        {
          name: 'jest',
          currentVersion: '^29.0.0',
          newVersion: '29.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'pkgx.yaml',
        },
      ]

      mockGenerateDependencyFileUpdates.mockResolvedValue([
        { path: 'deps.yaml', content: 'updated deps.yaml', type: 'update' },
        { path: 'dependencies.yml', content: 'updated dependencies.yml', type: 'update' },
        { path: 'pkgx.yaml', content: 'updated pkgx.yaml', type: 'update' },
      ])

      const result = await buddy.generatePackageJsonUpdates(mixedFileUpdates)

      expect(result).toHaveLength(4) // 1 package.json + 3 dependency files

      const paths = result.map(r => r.path).sort()
      expect(paths).toEqual(['deps.yaml', 'dependencies.yml', 'package.json', 'pkgx.yaml'].sort())
    })
  })

  describe('integration with scanning and update process', () => {
    it('should work with dependency files in the full update flow', async () => {
      // Mock package scanning to return both package.json and dependency files
      const mockPackageFiles = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{"dependencies": {"lodash": "^4.17.21"}}',
          dependencies: [
            {
              name: 'lodash',
              currentVersion: '^4.17.21',
              type: 'dependencies',
              file: 'package.json',
            },
          ],
        },
        {
          path: 'deps.yaml',
          type: 'deps.yaml',
          content: 'dependencies:\n  eslint: ^8.0.0',
          dependencies: [
            {
              name: 'eslint',
              currentVersion: '^8.0.0',
              type: 'dependencies',
              file: 'deps.yaml',
            },
          ],
        },
      ]

      mockScanProject.mockResolvedValue(mockPackageFiles)

      // Mock outdated packages
      mockGetOutdatedPackages.mockResolvedValue([
        {
          name: 'lodash',
          current: '4.17.21',
          update: '4.17.22',
          latest: '4.17.22',
        },
        {
          name: 'eslint',
          current: '8.0.0',
          update: '8.1.0',
          latest: '8.1.0',
        },
      ])

      // Mock file operations
      mockReadFileSync.mockReturnValue('{"dependencies": {"lodash": "^4.17.21"}}')
      mockGenerateDependencyFileUpdates.mockResolvedValue([
        {
          path: 'deps.yaml',
          content: 'dependencies:\n  eslint: ^8.1.0',
          type: 'update',
        },
      ])

      const scanResult = await buddy.scanForUpdates()

      expect(scanResult.updates).toHaveLength(2)
      expect(scanResult.totalPackages).toBe(2)

      // Verify both package.json and dependency file packages are included
      const packageNames = scanResult.updates.map(u => u.name).sort()
      expect(packageNames).toEqual(['eslint', 'lodash'])
    })
  })
})
