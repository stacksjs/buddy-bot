import type { PackageUpdate } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
// Import the real functions (not mocked) for testing the actual implementation
import {
  generateDependencyFileUpdates,
  isDependencyFile,
  parseDependencyFile,
  updateDependencyFile,
} from '../src/utils/dependency-file-parser'

// Test the real functions - only mock external dependencies
const mockResolveDependencyFile = mock()
mock.module('ts-pkgx', () => ({
  resolveDependencyFile: mockResolveDependencyFile,
}))

const mockReadFileSync = mock()
const mockExistsSync = mock()
mock.module('node:fs', () => {
  // eslint-disable-next-line ts/no-require-imports
  const originalFs = require('node:fs')
  return {
    ...originalFs,
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
  }
})

describe('Dependency File Parser', () => {
  beforeEach(() => {
    // Completely reset all mocks to ensure test isolation
    mockResolveDependencyFile.mockReset()
    mockReadFileSync.mockReset()
    mockExistsSync.mockReset()

    // Set up default mock behaviors
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('mock content')
  })

  afterEach(() => {
    // Complete cleanup
    mockResolveDependencyFile.mockReset()
    mockReadFileSync.mockReset()
    mockExistsSync.mockReset()

    // Try to restore if available
    mockResolveDependencyFile.mockRestore?.()
    mockReadFileSync.mockRestore?.()
    mockExistsSync.mockRestore?.()
  })

  describe('isDependencyFile', () => {
    it('should identify deps.yaml as dependency file', () => {
      expect(isDependencyFile('deps.yaml')).toBe(true)
      expect(isDependencyFile('./deps.yaml')).toBe(true)
      expect(isDependencyFile('/path/to/deps.yaml')).toBe(true)
    })

    it('should identify deps.yml as dependency file', () => {
      expect(isDependencyFile('deps.yml')).toBe(true)
      expect(isDependencyFile('./deps.yml')).toBe(true)
      expect(isDependencyFile('/path/to/deps.yml')).toBe(true)
    })

    it('should identify dependencies.yaml as dependency file', () => {
      expect(isDependencyFile('dependencies.yaml')).toBe(true)
      expect(isDependencyFile('./dependencies.yaml')).toBe(true)
      expect(isDependencyFile('/path/to/dependencies.yaml')).toBe(true)
    })

    it('should identify dependencies.yml as dependency file', () => {
      expect(isDependencyFile('dependencies.yml')).toBe(true)
      expect(isDependencyFile('./dependencies.yml')).toBe(true)
      expect(isDependencyFile('/path/to/dependencies.yml')).toBe(true)
    })

    it('should identify pkgx.yaml as dependency file', () => {
      expect(isDependencyFile('pkgx.yaml')).toBe(true)
      expect(isDependencyFile('./pkgx.yaml')).toBe(true)
      expect(isDependencyFile('/path/to/pkgx.yaml')).toBe(true)
    })

    it('should identify pkgx.yml as dependency file', () => {
      expect(isDependencyFile('pkgx.yml')).toBe(true)
      expect(isDependencyFile('./pkgx.yml')).toBe(true)
      expect(isDependencyFile('/path/to/pkgx.yml')).toBe(true)
    })

    it('should identify .deps.yaml as dependency file', () => {
      expect(isDependencyFile('.deps.yaml')).toBe(true)
      expect(isDependencyFile('./.deps.yaml')).toBe(true)
      expect(isDependencyFile('/path/to/.deps.yaml')).toBe(true)
    })

    it('should identify .deps.yml as dependency file', () => {
      expect(isDependencyFile('.deps.yml')).toBe(true)
      expect(isDependencyFile('./.deps.yml')).toBe(true)
      expect(isDependencyFile('/path/to/.deps.yml')).toBe(true)
    })

    it('should reject non-dependency files', () => {
      expect(isDependencyFile('package.json')).toBe(false)
      expect(isDependencyFile('README.md')).toBe(false)
      expect(isDependencyFile('config.yaml')).toBe(false)
      expect(isDependencyFile('docker-compose.yml')).toBe(false)
      expect(isDependencyFile('random.txt')).toBe(false)
      expect(isDependencyFile('dep.yaml')).toBe(false) // missing 's'
      expect(isDependencyFile('dependency.yaml')).toBe(false) // missing 'ies'
    })

    it('should handle edge cases', () => {
      expect(isDependencyFile('')).toBe(false)
      expect(isDependencyFile('/')).toBe(false)
      expect(isDependencyFile('.yaml')).toBe(false)
      expect(isDependencyFile('.yml')).toBe(false)
    })
  })

  describe('parseDependencyFile', () => {
    const mockFileContent = `dependencies:
  lodash: ^4.17.21
  react: ^18.0.0

devDependencies:
  typescript: ^5.0.0`

    it('should parse dependency file using ts-pkgx', async () => {
      const mockResolvedDeps = {
        allDependencies: [
          { name: 'lodash', constraint: '^4.17.21' },
          { name: 'react', constraint: '^18.0.0' },
        ],
      }

      mockResolveDependencyFile.mockResolvedValue(mockResolvedDeps)

      const result = await parseDependencyFile('deps.yaml', mockFileContent)

      expect(result).toBeDefined()
      expect(result?.path).toBe('deps.yaml')
      expect(result?.type).toBe('deps.yaml')
      expect(result?.content).toBe(mockFileContent)
      expect(result?.dependencies).toHaveLength(2)
      expect(result?.dependencies[0]).toEqual({
        name: 'lodash',
        currentVersion: '^4.17.21',
        type: 'dependencies',
        file: 'deps.yaml',
      })
      expect(result?.dependencies[1]).toEqual({
        name: 'react',
        currentVersion: '^18.0.0',
        type: 'dependencies',
        file: 'deps.yaml',
      })

      expect(mockResolveDependencyFile).toHaveBeenCalledWith('deps.yaml')
    })

    it('should handle empty allDependencies array', async () => {
      const mockResolvedDeps = {
        allDependencies: [],
      }

      mockResolveDependencyFile.mockResolvedValue(mockResolvedDeps)

      const result = await parseDependencyFile('deps.yaml', mockFileContent)

      expect(result).toBeDefined()
      expect(result?.dependencies).toHaveLength(0)
    })

    // Note: Fallback test removed because ts-pkgx only provides allDependencies,
    // not separate dependencies/devDependencies properties

    it('should return null for non-dependency files', async () => {
      const result = await parseDependencyFile('package.json', mockFileContent)
      expect(result).toBeNull()
    })

    it('should handle ts-pkgx resolution errors', async () => {
      mockResolveDependencyFile.mockRejectedValue(new Error('Failed to resolve'))

      const result = await parseDependencyFile('deps.yaml', mockFileContent)

      expect(result).toBeNull()
    })

    it('should handle invalid dependency data', async () => {
      const mockResolvedDeps = {
        allDependencies: [
          { name: 'lodash' }, // missing constraint
          { constraint: '^18.0.0' }, // missing name
          { name: 'react', constraint: '^18.0.0' }, // valid
        ],
      }

      mockResolveDependencyFile.mockResolvedValue(mockResolvedDeps)

      const result = await parseDependencyFile('deps.yaml', mockFileContent)

      expect(result).toBeDefined()
      expect(result?.dependencies).toHaveLength(1) // only the valid one
      expect(result?.dependencies[0].name).toBe('react')
    })

    it('should handle null/undefined resolved dependencies', async () => {
      mockResolveDependencyFile.mockResolvedValue(null)

      const result = await parseDependencyFile('deps.yaml', mockFileContent)

      expect(result).toBeDefined()
      expect(result?.dependencies).toHaveLength(0)
    })
  })

  describe('updateDependencyFile', () => {
    const mockFileContent = `dependencies:
  lodash: ^4.17.21
  react: ^18.0.0
  typescript: ~5.0.0

devDependencies:
  jest: ^29.0.0`

    const mockUpdates: PackageUpdate[] = [
      {
        name: 'lodash',
        currentVersion: '^4.17.21',
        newVersion: '4.17.22',
        updateType: 'patch',
        dependencyType: 'dependencies',
        file: 'deps.yaml',
      },
      {
        name: 'react',
        currentVersion: '^18.0.0',
        newVersion: '18.2.0',
        updateType: 'minor',
        dependencyType: 'dependencies',
        file: 'deps.yaml',
      },
    ]

    it('should update dependency versions preserving prefixes', async () => {
      const result = await updateDependencyFile('deps.yaml', mockFileContent, mockUpdates)

      expect(result).toContain('lodash: ^4.17.22')
      expect(result).toContain('react: ^18.2.0')
      expect(result).toContain('typescript: ~5.0.0') // unchanged
      expect(result).toContain('jest: ^29.0.0') // unchanged
    })

    it('should preserve original formatting and spacing', async () => {
      const formattedContent = `dependencies:
  lodash:    ^4.17.21
  react:^18.0.0
     typescript:  ~5.0.0`

      const result = await updateDependencyFile('deps.yaml', formattedContent, mockUpdates)

      // Should preserve the original spacing around colons
      expect(result).toContain('lodash:    ^4.17.22')
      expect(result).toContain('react:^18.2.0')
      expect(result).toContain('typescript:  ~5.0.0')
    })

    it('should handle packages without prefixes', async () => {
      const contentWithoutPrefixes = `dependencies:
  lodash: 4.17.21
  react: 18.0.0`

      const result = await updateDependencyFile('deps.yaml', contentWithoutPrefixes, mockUpdates)

      expect(result).toContain('lodash: 4.17.22')
      expect(result).toContain('react: 18.2.0')
    })

    it('should handle different version prefixes', async () => {
      const contentWithDifferentPrefixes = `dependencies:
  lodash: >=4.17.21
  react: ~18.0.0`

      const result = await updateDependencyFile('deps.yaml', contentWithDifferentPrefixes, mockUpdates)

      expect(result).toContain('lodash: >=4.17.22')
      expect(result).toContain('react: ~18.2.0')
    })

    it('should clean package names from dependency type suffixes', async () => {
      const updatesWithSuffixes: PackageUpdate[] = [
        {
          name: 'lodash (dev)',
          currentVersion: '^4.17.21',
          newVersion: '4.17.22',
          updateType: 'patch',
          dependencyType: 'devDependencies',
          file: 'deps.yaml',
        },
      ]

      const result = await updateDependencyFile('deps.yaml', mockFileContent, updatesWithSuffixes)

      expect(result).toContain('lodash: ^4.17.22')
    })

    it('should return original content for non-dependency files', async () => {
      const result = await updateDependencyFile('package.json', mockFileContent, mockUpdates)
      expect(result).toBe(mockFileContent)
    })

    it('should handle packages not found in file', async () => {
      const updatesWithMissingPackage: PackageUpdate[] = [
        {
          name: 'nonexistent-package',
          currentVersion: '^1.0.0',
          newVersion: '1.0.1',
          updateType: 'patch',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
      ]

      const result = await updateDependencyFile('deps.yaml', mockFileContent, updatesWithMissingPackage)

      // Should return unchanged content
      expect(result).toBe(mockFileContent)
    })

    it('should handle empty updates array', async () => {
      const result = await updateDependencyFile('deps.yaml', mockFileContent, [])
      expect(result).toBe(mockFileContent)
    })

    it('should handle update errors gracefully', async () => {
      // Test with malformed content
      const malformedContent = 'invalid yaml content {'

      const result = await updateDependencyFile('deps.yaml', malformedContent, mockUpdates)

      // Should return original content on error
      expect(result).toBe(malformedContent)
    })
  })

  describe('generateDependencyFileUpdates', () => {
    const mockUpdates: PackageUpdate[] = [
      {
        name: 'lodash',
        currentVersion: '^4.17.21',
        newVersion: '4.17.22',
        updateType: 'patch',
        dependencyType: 'dependencies',
        file: 'deps.yaml',
      },
      {
        name: 'react',
        currentVersion: '^18.0.0',
        newVersion: '18.2.0',
        updateType: 'minor',
        dependencyType: 'dependencies',
        file: 'dependencies.yml',
      },
      {
        name: 'typescript',
        currentVersion: '^5.0.0',
        newVersion: '5.1.0',
        updateType: 'minor',
        dependencyType: 'devDependencies',
        file: 'package.json', // Not a dependency file
      },
    ]

    const mockFileContent = `dependencies:
  lodash: ^4.17.21`

    const mockFileContent2 = `dependencies:
  react: ^18.0.0`

    beforeEach(() => {
      mockExistsSync.mockReturnValue(true)
    })

    it('should generate updates for dependency files only', async () => {
      mockReadFileSync
        .mockReturnValueOnce(mockFileContent) // deps.yaml
        .mockReturnValueOnce(mockFileContent2) // dependencies.yml

      const result = await generateDependencyFileUpdates(mockUpdates)

      expect(result).toHaveLength(2)

      const depsYamlUpdate = result.find(u => u.path === 'deps.yaml')
      const dependenciesYmlUpdate = result.find(u => u.path === 'dependencies.yml')

      expect(depsYamlUpdate).toBeDefined()
      expect(depsYamlUpdate?.type).toBe('update')
      expect(depsYamlUpdate?.content).toContain('lodash: ^4.17.22')

      expect(dependenciesYmlUpdate).toBeDefined()
      expect(dependenciesYmlUpdate?.type).toBe('update')
      expect(dependenciesYmlUpdate?.content).toContain('react: ^18.2.0')
    })

    it('should group updates by file correctly', async () => {
      const multipleUpdatesPerFile: PackageUpdate[] = [
        {
          name: 'lodash',
          currentVersion: '^4.17.21',
          newVersion: '4.17.22',
          updateType: 'patch',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
        {
          name: 'react',
          currentVersion: '^18.0.0',
          newVersion: '18.2.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'deps.yaml', // Same file
        },
      ]

      const combinedFileContent = `dependencies:
  lodash: ^4.17.21
  react: ^18.0.0`

      mockReadFileSync.mockReturnValue(combinedFileContent)

      const result = await generateDependencyFileUpdates(multipleUpdatesPerFile)

      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('deps.yaml')
      expect(result[0].content).toContain('lodash: ^4.17.22')
      expect(result[0].content).toContain('react: ^18.2.0')
    })

    it('should handle non-existent files gracefully', async () => {
      mockExistsSync.mockReturnValue(false)

      const result = await generateDependencyFileUpdates(mockUpdates)

      expect(result).toHaveLength(0)
      expect(mockReadFileSync).not.toHaveBeenCalled()
    })

    it('should handle file read errors gracefully', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied')
      })

      const result = await generateDependencyFileUpdates(mockUpdates)

      expect(result).toHaveLength(0)
    })

    it('should return empty array for no dependency file updates', async () => {
      const nonDependencyUpdates: PackageUpdate[] = [
        {
          name: 'typescript',
          currentVersion: '^5.0.0',
          newVersion: '5.1.0',
          updateType: 'minor',
          dependencyType: 'devDependencies',
          file: 'package.json',
        },
      ]

      const result = await generateDependencyFileUpdates(nonDependencyUpdates)

      expect(result).toHaveLength(0)
    })

    it('should handle empty updates array', async () => {
      const result = await generateDependencyFileUpdates([])

      expect(result).toHaveLength(0)
      expect(mockReadFileSync).not.toHaveBeenCalled()
    })

    it('should preserve file type as update', async () => {
      mockReadFileSync.mockReturnValue(mockFileContent)

      const result = await generateDependencyFileUpdates([mockUpdates[0]])

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('update')
    })
  })
})
