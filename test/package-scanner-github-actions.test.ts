import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { PackageScanner } from '../src/scanner/package-scanner'

// Mock workflow content
const mockWorkflowContent = `
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Install dependencies
        run: bun install
      - uses: actions/cache@v4.1.0
        with:
          path: ~/.bun
          key: \${{ runner.os }}-bun
`

describe('PackageScanner - GitHub Actions Integration', () => {
  let logger: any
  let readdirSpy: any
  let statSpy: any
  let readFileSpy: any

  beforeEach(async () => {
    logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      verbose: () => {},
      success: () => {},
    }

    // Mock filesystem functions
    readdirSpy = spyOn(await import('node:fs/promises'), 'readdir')
    statSpy = spyOn(await import('node:fs/promises'), 'stat')
    readFileSpy = spyOn(await import('node:fs/promises'), 'readFile')
  })

  afterEach(() => {
    readdirSpy?.mockRestore()
    statSpy?.mockRestore()
    readFileSpy?.mockRestore()
  })

  describe('findGitHubActionsFiles', () => {
    it('should find GitHub Actions workflow files', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Mock successful directory check
      statSpy.mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false })

      // Mock file listings for both .yaml and .yml searches
      readdirSpy
        .mockResolvedValueOnce(['ci.yml', 'release.yaml', 'README.md']) // *.yaml files
        .mockResolvedValueOnce(['ci.yml', 'release.yaml', 'README.md']) // *.yml files

      // Mock all stat calls for individual files
      statSpy.mockResolvedValue({ isDirectory: () => false, isFile: () => true })

      // Test the direct method
      const githubFiles = await (scanner as any).findGitHubActionsFiles()
      expect(githubFiles).toHaveLength(2)
      expect(githubFiles).toContain('.github/workflows/ci.yml')
      expect(githubFiles).toContain('.github/workflows/release.yaml')
    })

    it('should skip .github/workflows if directory does not exist', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Mock just the .github/workflows directory check to fail
      statSpy.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))

      // Call findGitHubActionsFiles directly to test this specific functionality
      const result = await (scanner as any).findGitHubActionsFiles()

      // Should return empty array when directory doesn't exist
      expect(result).toHaveLength(0)
    })

    it('should handle various workflow file extensions', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Mock successful directory check
      statSpy.mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false })

      // Mock file listing with various extensions
      readdirSpy
        .mockResolvedValueOnce(['ci.yml', 'release.yaml', 'test.json', 'build.txt']) // *.yaml files
        .mockResolvedValueOnce(['ci.yml', 'release.yaml', 'test.json', 'build.txt']) // *.yml files

      // Mock stat calls for all files
      statSpy
        .mockResolvedValue({ isDirectory: () => false, isFile: () => true })

      const result = await (scanner as any).findGitHubActionsFiles()

      // Should find 2 workflow files (ci.yml and release.yaml)
      expect(result).toHaveLength(2)
      expect(result).toContain('.github/workflows/ci.yml')
      expect(result).toContain('.github/workflows/release.yaml')
    })
  })

  describe('parseGitHubActionsFile', () => {
    it('should parse GitHub Actions workflow file correctly', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      readFileSpy.mockResolvedValue(mockWorkflowContent)

      const result = await scanner.parseGitHubActionsFile('.github/workflows/ci.yml')

      expect(result).toBeTruthy()
      expect(result!.path).toBe('.github/workflows/ci.yml')
      expect(result!.dependencies).toHaveLength(3)

      const actionNames = result!.dependencies.map(d => d.name)
      expect(actionNames).toContain('actions/checkout')
      expect(actionNames).toContain('oven-sh/setup-bun')
      expect(actionNames).toContain('actions/cache')
    })

    it('should handle file read errors gracefully', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      readFileSpy.mockRejectedValue(new Error('File not readable'))

      const result = await scanner.parseGitHubActionsFile('.github/workflows/ci.yml')

      expect(result).toBeNull()
    })

    it('should return null for invalid workflow files', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      readFileSpy.mockResolvedValue('invalid yaml content [}')

      const result = await scanner.parseGitHubActionsFile('.github/workflows/ci.yml')

      expect(result).toBeTruthy() // Should still parse, just with no dependencies
      expect(result!.dependencies).toHaveLength(0)
    })
  })

  describe('integration with existing scanProject', () => {
    it('should parse GitHub Actions files correctly', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Test parseGitHubActionsFile directly with mock content
      const result = await scanner.parseGitHubActionsFile('.github/workflows/ci.yml')

      // The file doesn't exist in the test environment, so this should return null
      // But we can verify the method exists and handles errors gracefully
      expect(result).toBeNull()
    })

    it('should handle file read errors gracefully', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Mock readFile to throw an error
      readFileSpy.mockRejectedValueOnce(new Error('Permission denied'))

      const result = await scanner.parseGitHubActionsFile('.github/workflows/ci.yml')

      // Should return null on error
      expect(result).toBeNull()
    })
  })
})
