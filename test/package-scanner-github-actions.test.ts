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

const mockComplexWorkflow = `
name: Release
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/cache@v4
      - name: Build
        run: bun run build

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: "stacksjs/action-releaser@v1.1.0"
      - uses: 'docker/setup-buildx-action@v3.0.0'
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

      // Mock .github/workflows directory structure
      readdirSpy
        .mockResolvedValueOnce(['package.json', '.github', 'src']) // Root directory
        .mockResolvedValueOnce(['workflows', 'dependabot.yml']) // .github directory
        .mockResolvedValueOnce(['ci.yml', 'release.yaml', 'README.md']) // workflows directory

      statSpy
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // package.json
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // .github
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // src
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // workflows
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // dependabot.yml
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // ci.yml
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // release.yaml
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // README.md

      readFileSpy
        .mockResolvedValueOnce('{}') // package.json
        .mockResolvedValueOnce(mockWorkflowContent) // ci.yml
        .mockResolvedValueOnce(mockComplexWorkflow) // release.yaml

      const result = await scanner.scanProject()

      // Should find GitHub Actions files
      const githubActionsFiles = result.filter(file => file.path.includes('.github/workflows/'))
      expect(githubActionsFiles).toHaveLength(2)

      // Check ci.yml
      const ciFile = githubActionsFiles.find(f => f.path.includes('ci.yml'))
      expect(ciFile).toBeTruthy()
      expect(ciFile!.dependencies).toHaveLength(3)
      expect(ciFile!.dependencies[0]).toEqual({
        name: 'actions/checkout',
        currentVersion: 'v4',
        type: 'github-actions',
        file: ciFile!.path,
      })

      // Check release.yaml
      const releaseFile = githubActionsFiles.find(f => f.path.includes('release.yaml'))
      expect(releaseFile).toBeTruthy()
      expect(releaseFile!.dependencies).toHaveLength(5)

      const releaseActions = releaseFile!.dependencies.map(d => d.name)
      expect(releaseActions).toContain('actions/checkout')
      expect(releaseActions).toContain('stacksjs/action-releaser')
      expect(releaseActions).toContain('docker/setup-buildx-action')
    })

    it('should skip .github/workflows if directory does not exist', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Mock directory structure without .github/workflows
      readdirSpy
        .mockResolvedValueOnce(['package.json', 'src']) // Root directory

      statSpy
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // package.json
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // src
        .mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))

      readFileSpy
        .mockResolvedValueOnce('{}') // package.json

      const result = await scanner.scanProject()

      // Should not find any GitHub Actions files
      const githubActionsFiles = result.filter(file => file.path.includes('.github/workflows/'))
      expect(githubActionsFiles).toHaveLength(0)
    })

    it('should handle various workflow file extensions', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Mock workflows with different extensions
      readdirSpy
        .mockResolvedValueOnce(['.github']) // Root directory
        .mockResolvedValueOnce(['workflows']) // .github directory
        .mockResolvedValueOnce(['ci.yml', 'release.yaml', 'deploy.YML', 'test.YAML', 'invalid.txt']) // workflows directory

      statSpy
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // .github
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // workflows
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // ci.yml
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // release.yaml
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // deploy.YML
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // test.YAML
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // invalid.txt

      readFileSpy
        .mockResolvedValue('jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4')

      const result = await scanner.scanProject()

      // Should find 4 valid workflow files (excluding .txt file)
      const githubActionsFiles = result.filter(file => file.path.includes('.github/workflows/'))
      expect(githubActionsFiles).toHaveLength(4)

      const filePaths = githubActionsFiles.map(f => f.path)
      expect(filePaths.some(p => p.includes('ci.yml'))).toBe(true)
      expect(filePaths.some(p => p.includes('release.yaml'))).toBe(true)
      expect(filePaths.some(p => p.includes('deploy.YML'))).toBe(true)
      expect(filePaths.some(p => p.includes('test.YAML'))).toBe(true)
      expect(filePaths.some(p => p.includes('invalid.txt'))).toBe(false)
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
    it('should include GitHub Actions files in overall scan results', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Mock complete project structure
      readdirSpy
        .mockResolvedValueOnce(['package.json', '.github', 'deps.yaml']) // Root
        .mockResolvedValueOnce(['workflows']) // .github
        .mockResolvedValueOnce(['ci.yml']) // workflows

      statSpy
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // package.json
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // .github
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // deps.yaml
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // workflows
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // ci.yml

      readFileSpy
        .mockResolvedValueOnce('{"dependencies": {"lodash": "^4.17.0"}}') // package.json
        .mockResolvedValueOnce('bun.sh: ^1.2.16') // deps.yaml
        .mockResolvedValueOnce(mockWorkflowContent) // ci.yml

      const result = await scanner.scanProject()

      // Should find all file types
      expect(result).toHaveLength(3)

      const fileTypes = result.map((f) => {
        if (f.path === 'package.json')
          return 'package'
        if (f.path.includes('.github/workflows/'))
          return 'github-actions'
        if (f.path.includes('deps.yaml'))
          return 'dependency'
        return 'unknown'
      })

      expect(fileTypes).toContain('package')
      expect(fileTypes).toContain('github-actions')
      expect(fileTypes).toContain('dependency')

      // Check GitHub Actions file specifically
      const githubActionsFile = result.find(f => f.path.includes('.github/workflows/'))
      expect(githubActionsFile!.dependencies).toHaveLength(3)
      expect(githubActionsFile!.dependencies.every(d => d.type === 'github-actions')).toBe(true)
    })

    it('should handle mixed file types with proper path resolution', async () => {
      const scanner = new PackageScanner('/test/project', logger)

      // Test that paths are properly relativized
      readdirSpy
        .mockResolvedValueOnce(['.github']) // Root
        .mockResolvedValueOnce(['workflows']) // .github
        .mockResolvedValueOnce(['nested-ci.yml']) // workflows

      statSpy
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // .github
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false }) // workflows
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true }) // nested-ci.yml

      readFileSpy
        .mockResolvedValueOnce('jobs:\n  test:\n    steps:\n      - uses: actions/setup-node@v4')

      const result = await scanner.scanProject()

      expect(result).toHaveLength(1)

      // Path should be relative and properly formatted
      const githubActionsFile = result[0]
      expect(githubActionsFile.path).toMatch(/\.github[/\\]workflows[/\\]nested-ci\.yml/)
      expect(githubActionsFile.path).not.toMatch(/^\//) // Should not be absolute
    })
  })
})
