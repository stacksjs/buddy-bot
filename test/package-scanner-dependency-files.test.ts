import type { PackageFile } from '../src/types'
import type { Logger } from '../src/utils/logger'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as fsPromises from 'node:fs/promises'
import { PackageScanner } from '../src/scanner/package-scanner'
import * as dependencyFileParser from '../src/utils/dependency-file-parser'

// Create mocks
const mockReadFile = mock()
const mockReaddir = mock()
const mockStat = mock()
const mockParseDependencyFile = mock()
const mockIsDependencyFile = mock()

describe.skip('PackageScanner - Dependency Files Integration', () => {
  let scanner: PackageScanner
  let mockLogger: Logger

  let readFileSpy: any
  let readdirSpy: any
  let statSpy: any
  let parseDependencyFileSpy: any
  let isDependencyFileSpy: any

  beforeEach(() => {
    // Setup spies
    readFileSpy = spyOn(fsPromises, 'readFile').mockImplementation(mockReadFile)
    readdirSpy = spyOn(fsPromises, 'readdir').mockImplementation(mockReaddir)
    statSpy = spyOn(fsPromises, 'stat').mockImplementation(mockStat)
    parseDependencyFileSpy = spyOn(dependencyFileParser, 'parseDependencyFile').mockImplementation(mockParseDependencyFile)
    isDependencyFileSpy = spyOn(dependencyFileParser, 'isDependencyFile').mockImplementation(mockIsDependencyFile)

    // Create a mock logger
    mockLogger = {
      info: mock(),
      warn: mock(),
      error: mock(),
      success: mock(),
      debug: mock(),
    } as unknown as Logger

    scanner = new PackageScanner('/test/project', mockLogger)

    // Reset all mocks
    mockReadFile.mockReset()
    mockReaddir.mockReset()
    mockStat.mockReset()
    mockParseDependencyFile.mockReset()
    mockIsDependencyFile.mockReset()
  })

  afterEach(() => {
    // Restore spies
    readFileSpy?.mockRestore()
    readdirSpy?.mockRestore()
    statSpy?.mockRestore()
    parseDependencyFileSpy?.mockRestore()
    isDependencyFileSpy?.mockRestore()

    // Clear all mocks
    mockReadFile.mockClear()
    mockReaddir.mockClear()
    mockStat.mockClear()
    mockParseDependencyFile.mockClear()
    mockIsDependencyFile.mockClear()
  })

  const mockPackageJsonContent = JSON.stringify({
    name: 'test-project',
    dependencies: {
      lodash: '^4.17.21',
    },
  })

  const mockDepsYamlContent = `dependencies:
  react: ^18.0.0
  typescript: ^5.0.0`

  const mockDepsYamlFile: PackageFile = {
    path: 'deps.yaml',
    type: 'deps.yaml',
    content: mockDepsYamlContent,
    dependencies: [
      {
        name: 'react',
        currentVersion: '^18.0.0',
        type: 'dependencies',
        file: 'deps.yaml',
      },
      {
        name: 'typescript',
        currentVersion: '^5.0.0',
        type: 'dependencies',
        file: 'deps.yaml',
      },
    ],
  }

  describe('scanProject with dependency files', () => {
    const _mockPackageJsonFile: PackageFile = {
      path: 'package.json',
      type: 'package.json',
      content: mockPackageJsonContent,
      dependencies: [
        {
          name: 'lodash',
          currentVersion: '^4.17.21',
          type: 'dependencies',
          file: 'package.json',
        },
      ],
    }

    it('should scan and include both package.json and dependency files', async () => {
      // Mock directory structure with both package.json and deps.yaml
      mockReaddir.mockResolvedValueOnce(['package.json', 'deps.yaml', 'src'])

      // Mock stat calls
      mockStat
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // package.json
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // deps.yaml
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // src

      // Mock nested directory (src) - empty
      mockReaddir.mockResolvedValueOnce([])

      // Mock file reading
      mockReadFile
        .mockResolvedValueOnce(mockPackageJsonContent) // package.json
        .mockResolvedValueOnce(mockDepsYamlContent) // deps.yaml

      // Mock dependency file parsing
      mockParseDependencyFile.mockResolvedValue(mockDepsYamlFile)

      const result = await scanner.scanProject()

      expect(result).toHaveLength(2)

      const packageJsonFile = result.find(f => f.path === 'package.json')
      const depsYamlFile = result.find(f => f.path === 'deps.yaml')

      expect(packageJsonFile).toBeDefined()
      expect(packageJsonFile?.type).toBe('package.json')
      expect(packageJsonFile?.dependencies).toHaveLength(1)

      expect(depsYamlFile).toBeDefined()
      expect(depsYamlFile?.type).toBe('deps.yaml')
      expect(depsYamlFile?.dependencies).toHaveLength(2)
    })

    it('should handle multiple dependency file types', async () => {
      const dependencyFiles = [
        'deps.yaml',
        'deps.yml',
        'dependencies.yaml',
        'dependencies.yml',
        'pkgx.yaml',
        'pkgx.yml',
        '.deps.yaml',
        '.deps.yml',
      ]

      // Mock directory structure
      mockReaddir.mockResolvedValueOnce(['package.json', ...dependencyFiles])

      // Mock stat calls - all files
      for (let i = 0; i < dependencyFiles.length + 1; i++) {
        mockStat.mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
      }

      // Mock file reading
      mockReadFile.mockResolvedValue(mockDepsYamlContent)

      // Mock dependency file parsing for each file
      for (const fileName of dependencyFiles) {
        mockParseDependencyFile.mockResolvedValueOnce({
          path: fileName,
          type: fileName,
          content: mockDepsYamlContent,
          dependencies: [
            {
              name: 'react',
              currentVersion: '^18.0.0',
              type: 'dependencies',
              file: fileName,
            },
          ],
        })
      }

      const result = await scanner.scanProject()

      expect(result).toHaveLength(dependencyFiles.length + 1) // +1 for package.json

      // Verify each dependency file was processed
      for (const fileName of dependencyFiles) {
        const file = result.find(f => f.path === fileName)
        expect(file).toBeDefined()
        expect(file?.type).toBe(fileName as any)
      }
    })

    it('should handle nested dependency files', async () => {
      // Mock root directory
      mockReaddir.mockResolvedValueOnce(['package.json', 'src', 'config'])

      // Mock stat calls for root
      mockStat
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // package.json
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // src
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // config

      // Mock src directory
      mockReaddir.mockResolvedValueOnce(['index.ts'])
      mockStat.mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })

      // Mock config directory with deps.yaml
      mockReaddir.mockResolvedValueOnce(['deps.yaml'])
      mockStat.mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })

      // Mock file reading
      mockReadFile
        .mockResolvedValueOnce(mockPackageJsonContent) // package.json
        .mockResolvedValueOnce(mockDepsYamlContent) // config/deps.yaml

      // Mock dependency file parsing
      mockParseDependencyFile.mockResolvedValue({
        path: '/test/project/config/deps.yaml',
        type: 'deps.yaml',
        content: mockDepsYamlContent,
        dependencies: [
          {
            name: 'react',
            currentVersion: '^18.0.0',
            type: 'dependencies',
            file: '/test/project/config/deps.yaml',
          },
        ],
      })

      const result = await scanner.scanProject()

      expect(result).toHaveLength(2)

      const nestedDepsFile = result.find(f => f.path.includes('config/deps.yaml'))
      expect(nestedDepsFile).toBeDefined()
    })

    it('should skip node_modules and other ignored directories', async () => {
      // Mock root directory with node_modules
      mockReaddir.mockResolvedValueOnce(['package.json', 'node_modules', 'deps.yaml'])

      // Mock stat calls
      mockStat
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // package.json
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // node_modules
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // deps.yaml

      // Mock file reading (node_modules should not be read)
      mockReadFile
        .mockResolvedValueOnce(mockPackageJsonContent) // package.json
        .mockResolvedValueOnce(mockDepsYamlContent) // deps.yaml

      // Mock dependency file parsing
      mockParseDependencyFile.mockResolvedValue(mockDepsYamlFile)

      const result = await scanner.scanProject()

      expect(result).toHaveLength(2)

      // Verify node_modules was skipped (no extra readdir call for it)
      expect(mockReaddir).toHaveBeenCalledTimes(1)
    })

    it('should handle dependency file parsing errors gracefully', async () => {
      mockReaddir.mockResolvedValueOnce(['package.json', 'deps.yaml'])

      mockStat
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })

      mockReadFile
        .mockResolvedValueOnce(mockPackageJsonContent)
        .mockResolvedValueOnce(mockDepsYamlContent)

      // Mock dependency file parsing to fail
      mockParseDependencyFile.mockResolvedValue(null)

      const result = await scanner.scanProject()

      expect(result).toHaveLength(1) // Only package.json should be included
      expect(result[0].path).toBe('package.json')
    })

    it('should handle file read errors gracefully', async () => {
      mockReaddir.mockResolvedValueOnce(['package.json', 'deps.yaml'])

      mockStat
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })

      mockReadFile
        .mockResolvedValueOnce(mockPackageJsonContent)
        .mockRejectedValueOnce(new Error('Permission denied'))

      const result = await scanner.scanProject()

      expect(result).toHaveLength(1) // Only package.json should be included
      expect(result[0].path).toBe('package.json')
    })
  })

  describe('findDependencyFiles', () => {
    it('should find dependency files by pattern matching', async () => {
      // This tests the private method indirectly through scanProject
      mockReaddir.mockResolvedValueOnce(['deps.yaml', 'config.yaml', 'docker-compose.yml'])

      mockStat
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })

      mockReadFile.mockResolvedValue('content')

      // Mock isDependencyFile to return true only for deps.yaml
      mockIsDependencyFile
        .mockReturnValueOnce(true) // deps.yaml
        .mockReturnValueOnce(false) // config.yaml
        .mockReturnValueOnce(false) // docker-compose.yml

      mockParseDependencyFile.mockResolvedValue({
        path: 'deps.yaml',
        type: 'deps.yaml',
        content: 'content',
        dependencies: [],
      })

      const result = await scanner.scanProject()

      // Should only include deps.yaml, not the other YAML files
      const dependencyFiles = result.filter(f => f.type !== 'package.json')
      expect(dependencyFiles).toHaveLength(1)
      expect(dependencyFiles[0].path).toBe('deps.yaml')
    })
  })

  describe('parseDependencyFile method', () => {
    it('should call dependency file parser correctly', async () => {
      mockReadFile.mockResolvedValue(mockDepsYamlContent)
      mockParseDependencyFile.mockResolvedValue(mockDepsYamlFile)

      // Use reflection to access private method for testing
      const result = await (scanner as any).parseDependencyFile('/test/path/deps.yaml')

      expect(mockReadFile).toHaveBeenCalledWith('/test/path/deps.yaml', 'utf-8')
      expect(mockParseDependencyFile).toHaveBeenCalledWith('/test/path/deps.yaml', mockDepsYamlContent)
      expect(result).toEqual(mockDepsYamlFile)
    })

    it('should handle file read errors', async () => {
      mockReadFile.mockRejectedValue(new Error('File not found'))

      const result = await (scanner as any).parseDependencyFile('/test/path/deps.yaml')

      expect(result).toBeNull()
    })

    it('should handle parser errors', async () => {
      mockReadFile.mockResolvedValue(mockDepsYamlContent)
      mockParseDependencyFile.mockRejectedValue(new Error('Parse error'))

      const result = await (scanner as any).parseDependencyFile('/test/path/deps.yaml')

      expect(result).toBeNull()
    })
  })

  describe('integration with existing package.json scanning', () => {
    it('should not interfere with existing package.json functionality', async () => {
      mockReaddir.mockResolvedValueOnce(['package.json'])
      mockStat.mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
      mockReadFile.mockResolvedValueOnce(mockPackageJsonContent)

      const result = await scanner.scanProject()

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('package.json')
      expect(result[0].dependencies).toBeDefined()

      // Verify dependency file parser was not called
      expect(mockParseDependencyFile).not.toHaveBeenCalled()
    })

    it('should correctly combine package.json and dependency file results', async () => {
      mockReaddir.mockResolvedValueOnce(['package.json', 'deps.yaml'])

      mockStat
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })

      mockReadFile
        .mockResolvedValueOnce(mockPackageJsonContent)
        .mockResolvedValueOnce(mockDepsYamlContent)

      mockParseDependencyFile.mockResolvedValue(mockDepsYamlFile)

      const result = await scanner.scanProject()

      expect(result).toHaveLength(2)

      const totalDependencies = result.reduce((sum, file) => sum + file.dependencies.length, 0)
      expect(totalDependencies).toBe(3) // 1 from package.json + 2 from deps.yaml
    })
  })
})
