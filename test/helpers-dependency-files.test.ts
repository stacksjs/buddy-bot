import type { PackageFile } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { parsePackageFile } from '../src/utils/helpers'

// Mock dependency file parser
const mockParseDependencyFile = mock()
const mockIsDependencyFile = mock()
mock.module('../src/utils/dependency-file-parser', () => ({
  parseDependencyFile: mockParseDependencyFile,
  isDependencyFile: mockIsDependencyFile,
}))

describe('Helpers - Dependency Files Integration', () => {
  beforeEach(() => {
    // Reset all mocks
    mockParseDependencyFile.mockReset()
    mockIsDependencyFile.mockReset()
  })

  afterEach(() => {
    // Clear all mocks
    mockParseDependencyFile.mockClear()
    mockIsDependencyFile.mockClear()
  })

  describe('parsePackageFile with dependency files', () => {
    const mockPackageJsonContent = JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      dependencies: {
        lodash: '^4.17.21',
        react: '^18.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
        jest: '^29.0.0',
      },
      peerDependencies: {
        'react-dom': '^18.0.0',
      },
      optionalDependencies: {
        fsevents: '^2.3.0',
      },
    })

    const mockDepsYamlContent = `dependencies:
  eslint: ^8.0.0
  prettier: ^2.8.0

devDependencies:
  husky: ^8.0.0`

    it('should parse package.json files as before', async () => {
      mockIsDependencyFile.mockReturnValue(false)

      const result = await parsePackageFile(mockPackageJsonContent, 'package.json')

      expect(result).toBeDefined()
      expect(result?.path).toBe('package.json')
      expect(result?.type).toBe('package.json')
      expect(result?.content).toBe(mockPackageJsonContent)
      expect(result?.dependencies).toHaveLength(6) // 2 deps + 2 devDeps + 1 peerDep + 1 optionalDep

      // Verify dependency types
      const deps = result?.dependencies || []
      expect(deps.filter(d => d.type === 'dependencies')).toHaveLength(2)
      expect(deps.filter(d => d.type === 'devDependencies')).toHaveLength(2)
      expect(deps.filter(d => d.type === 'peerDependencies')).toHaveLength(1)
      expect(deps.filter(d => d.type === 'optionalDependencies')).toHaveLength(1)

      // Verify dependency file parser was not called
      expect(mockParseDependencyFile).not.toHaveBeenCalled()
    })

    it('should parse dependency files using dependency file parser', async () => {
      const mockDependencyFile: PackageFile = {
        path: 'deps.yaml',
        type: 'deps.yaml',
        content: mockDepsYamlContent,
        dependencies: [
          {
            name: 'eslint',
            currentVersion: '^8.0.0',
            type: 'dependencies',
            file: 'deps.yaml',
          },
          {
            name: 'prettier',
            currentVersion: '^2.8.0',
            type: 'dependencies',
            file: 'deps.yaml',
          },
          {
            name: 'husky',
            currentVersion: '^8.0.0',
            type: 'devDependencies',
            file: 'deps.yaml',
          },
        ],
      }

      mockIsDependencyFile.mockReturnValue(true)
      mockParseDependencyFile.mockResolvedValue(mockDependencyFile)

      const result = await parsePackageFile(mockDepsYamlContent, 'deps.yaml')

      expect(result).toBeDefined()
      expect(result?.path).toBe('deps.yaml')
      expect(result?.type).toBe('deps.yaml')
      expect(result?.content).toBe(mockDepsYamlContent)
      expect(result?.dependencies).toHaveLength(3)

      // Verify the dependency file parser was called
      expect(mockIsDependencyFile).toHaveBeenCalledWith('deps.yaml')
      expect(mockParseDependencyFile).toHaveBeenCalledWith('deps.yaml', mockDepsYamlContent)
    })

    it('should handle different dependency file types', async () => {
      const dependencyFileTypes = [
        'deps.yaml',
        'deps.yml',
        'dependencies.yaml',
        'dependencies.yml',
        'pkgx.yaml',
        'pkgx.yml',
        '.deps.yaml',
        '.deps.yml',
      ]

      for (const fileName of dependencyFileTypes) {
        mockIsDependencyFile.mockReturnValue(true)
        mockParseDependencyFile.mockResolvedValue({
          path: fileName,
          type: fileName,
          content: mockDepsYamlContent,
          dependencies: [],
        })

        const result = await parsePackageFile(mockDepsYamlContent, fileName)

        expect(result).toBeDefined()
        expect(result?.path).toBe(fileName)
        expect(result?.type).toBe(fileName)
        expect(mockParseDependencyFile).toHaveBeenCalledWith(fileName, mockDepsYamlContent)
      }
    })

    it('should handle dependency file parser returning null', async () => {
      mockIsDependencyFile.mockReturnValue(true)
      mockParseDependencyFile.mockResolvedValue(null)

      const result = await parsePackageFile(mockDepsYamlContent, 'deps.yaml')

      expect(result).toBeNull()
      expect(mockParseDependencyFile).toHaveBeenCalledWith('deps.yaml', mockDepsYamlContent)
    })

    it('should handle dependency file parser errors', async () => {
      mockIsDependencyFile.mockReturnValue(true)
      mockParseDependencyFile.mockRejectedValue(new Error('Parse error'))

      const result = await parsePackageFile(mockDepsYamlContent, 'deps.yaml')

      expect(result).toBeNull()
      expect(mockParseDependencyFile).toHaveBeenCalledWith('deps.yaml', mockDepsYamlContent)
    })

    it('should return null for unrecognized file types', async () => {
      mockIsDependencyFile.mockReturnValue(false)

      const result = await parsePackageFile('some content', 'unknown.txt')

      expect(result).toBeNull()
      expect(mockParseDependencyFile).not.toHaveBeenCalled()
    })

    it('should handle malformed package.json gracefully', async () => {
      mockIsDependencyFile.mockReturnValue(false)

      const malformedJson = '{"name": "test", invalid json'
      const result = await parsePackageFile(malformedJson, 'package.json')

      expect(result).toBeNull()
    })

    it('should handle package.json without dependencies sections', async () => {
      mockIsDependencyFile.mockReturnValue(false)

      const minimalPackageJson = JSON.stringify({
        name: 'minimal-project',
        version: '1.0.0',
      })

      const result = await parsePackageFile(minimalPackageJson, 'package.json')

      expect(result).toBeDefined()
      expect(result?.dependencies).toHaveLength(0)
    })

    it('should handle nested directory paths correctly', async () => {
      const nestedPath = 'config/deps.yaml'

      mockIsDependencyFile.mockReturnValue(true)
      mockParseDependencyFile.mockResolvedValue({
        path: nestedPath,
        type: 'deps.yaml',
        content: mockDepsYamlContent,
        dependencies: [
          {
            name: 'eslint',
            currentVersion: '^8.0.0',
            type: 'dependencies',
            file: nestedPath,
          },
        ],
      })

      const result = await parsePackageFile(mockDepsYamlContent, nestedPath)

      expect(result).toBeDefined()
      expect(result?.path).toBe(nestedPath)
      expect(result?.dependencies[0].file).toBe(nestedPath)
      expect(mockParseDependencyFile).toHaveBeenCalledWith(nestedPath, mockDepsYamlContent)
    })

    it('should maintain backwards compatibility with existing package.json parsing', async () => {
      mockIsDependencyFile.mockReturnValue(false)

      const packageJson = JSON.stringify({
        name: 'test-project',
        dependencies: {
          'lodash': '^4.17.21',
          '@types/node': '^18.0.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      })

      const result = await parsePackageFile(packageJson, 'package.json')

      expect(result).toBeDefined()
      expect(result?.type).toBe('package.json')
      expect(result?.dependencies).toHaveLength(3)

      // Verify all dependencies have correct structure
      const deps = result?.dependencies || []
      expect(deps.every(d => d.name && d.currentVersion && d.type && d.file)).toBe(true)

      // Verify specific dependency
      const lodashDep = deps.find(d => d.name === 'lodash')
      expect(lodashDep).toBeDefined()
      expect(lodashDep?.currentVersion).toBe('^4.17.21')
      expect(lodashDep?.type).toBe('dependencies')
      expect(lodashDep?.file).toBe('package.json')
    })

    it('should handle concurrent calls to parsePackageFile', async () => {
      mockIsDependencyFile.mockReturnValue(true)
      mockParseDependencyFile.mockImplementation(async (path, content) => ({
        path,
        type: path,
        content,
        dependencies: [],
      }))

      const promises = [
        parsePackageFile(mockDepsYamlContent, 'deps.yaml'),
        parsePackageFile(mockPackageJsonContent, 'package.json'),
        parsePackageFile(mockDepsYamlContent, 'dependencies.yml'),
      ]

      // Set different return values for isDependencyFile calls
      mockIsDependencyFile
        .mockReturnValueOnce(true) // deps.yaml
        .mockReturnValueOnce(false) // package.json
        .mockReturnValueOnce(true) // dependencies.yml

      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      expect(results[0]?.path).toBe('deps.yaml')
      expect(results[1]?.path).toBe('package.json')
      expect(results[2]?.path).toBe('dependencies.yml')
    })
  })
})
