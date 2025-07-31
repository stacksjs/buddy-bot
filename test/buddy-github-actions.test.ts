import type { BuddyBotConfig, PackageFile, PackageUpdate } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { Buddy } from '../src/buddy'

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

const mockGitHubActionsFile: PackageFile = {
  path: '.github/workflows/ci.yml',
  type: 'github-actions',
  content: `
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/cache@v4.1.0
`,
  dependencies: [
    {
      name: 'actions/checkout',
      currentVersion: 'v4',
      type: 'github-actions',
      file: '.github/workflows/ci.yml',
    },
    {
      name: 'oven-sh/setup-bun',
      currentVersion: 'v2',
      type: 'github-actions',
      file: '.github/workflows/ci.yml',
    },
    {
      name: 'actions/cache',
      currentVersion: 'v4.1.0',
      type: 'github-actions',
      file: '.github/workflows/ci.yml',
    },
  ],
}

describe('Buddy - GitHub Actions Integration', () => {
  let packageScannerSpy: any
  let registryClientSpy: any
  let fetchSpy: any
  let resolveDependencyFileSpy: any

  beforeEach(async () => {
    // Mock console methods to reduce test output noise
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'info').mockImplementation(() => {})
    spyOn(console, 'warn').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})

    // Mock ts-pkgx to prevent real dependency file parsing
    resolveDependencyFileSpy = spyOn(await import('ts-pkgx'), 'resolveDependencyFile')
    resolveDependencyFileSpy.mockResolvedValue({ allDependencies: [] })

    // Ensure we have fresh mocks for each test even if modules are globally mocked
    // This prevents interference from other test files
    const { PackageScanner } = await import('../src/scanner/package-scanner')
    const { RegistryClient } = await import('../src/registry/registry-client')

    // Re-establish spies on the classes to ensure they work regardless of global mocks
    packageScannerSpy = spyOn(PackageScanner.prototype, 'scanProject')
    registryClientSpy = spyOn(RegistryClient.prototype, 'getOutdatedPackages')
  })

  afterEach(() => {
    packageScannerSpy?.mockRestore()
    registryClientSpy?.mockRestore()
    fetchSpy?.mockRestore()
    resolveDependencyFileSpy?.mockRestore()
  })

  describe('checkGitHubActionsForUpdates', () => {
    it('should detect GitHub Actions updates', async () => {
      const buddy = new Buddy(mockConfig)

      // Mock GitHub API responses
      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: 'v4.2.2' }),
        } as Response) // actions/checkout
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: 'v2.0.2' }),
        } as Response) // oven-sh/setup-bun
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: 'v4.1.0' }),
        } as Response) // actions/cache (no update)

      // Mock PackageScanner to return GitHub Actions file
      packageScannerSpy.mockResolvedValue([mockGitHubActionsFile])

      // Mock registry client for empty package.json updates
      registryClientSpy.mockResolvedValue([])

      const result = await buddy.scanForUpdates()

      expect(result.updates).toHaveLength(2) // Only checkout and setup-bun have updates

      // Check actions/checkout update
      const checkoutUpdate = result.updates.find(u => u.name === 'actions/checkout')
      expect(checkoutUpdate).toBeTruthy()
      expect(checkoutUpdate!.currentVersion).toBe('v4')
      expect(checkoutUpdate!.newVersion).toBe('v4.2.2')
      expect(checkoutUpdate!.dependencyType).toBe('github-actions')
      expect(checkoutUpdate!.file).toBe('.github/workflows/ci.yml')
      expect(checkoutUpdate!.updateType).toBe('minor') // v4 -> v4.2.2 is a minor update

      // Check oven-sh/setup-bun update
      const setupBunUpdate = result.updates.find(u => u.name === 'oven-sh/setup-bun')
      expect(setupBunUpdate).toBeTruthy()
      expect(setupBunUpdate!.currentVersion).toBe('v2')
      expect(setupBunUpdate!.newVersion).toBe('v2.0.2')
      expect(setupBunUpdate!.dependencyType).toBe('github-actions')

      // Verify no update for actions/cache (same version)
      const cacheUpdate = result.updates.find(u => u.name === 'actions/cache')
      expect(cacheUpdate).toBeFalsy()
    })

    it('should handle GitHub API failures gracefully', async () => {
      const buddy = new Buddy(mockConfig)

      // Mock GitHub API to fail
      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        } as Response) // actions/checkout (not found)
        .mockRejectedValueOnce(new Error('Network error')) // oven-sh/setup-bun (network error)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: 'v4.2.0' }),
        } as Response) // actions/cache (success)

      packageScannerSpy.mockResolvedValue([mockGitHubActionsFile])
      registryClientSpy.mockResolvedValue([])

      const result = await buddy.scanForUpdates()

      // Should only have updates for actions that succeeded
      expect(result.updates).toHaveLength(1)

      const cacheUpdate = result.updates.find(u => u.name === 'actions/cache')
      expect(cacheUpdate).toBeTruthy()
      expect(cacheUpdate!.newVersion).toBe('v4.2.0')
    })

    it('should filter out non-GitHub Actions files', async () => {
      const buddy = new Buddy(mockConfig)

      const mixedFiles: PackageFile[] = [
        mockGitHubActionsFile,
        {
          path: 'package.json',
          type: 'package.json' as any,
          content: '{}',
          dependencies: [],
        },
        {
          path: 'deps.yaml',
          type: 'deps.yaml' as any,
          content: 'bun.sh: ^1.2.16',
          dependencies: [],
        },
      ]

      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValue({
          ok: true,
          json: async () => ({ tag_name: 'v4.2.2' }),
        } as Response)

      packageScannerSpy.mockResolvedValue(mixedFiles)

      registryClientSpy.mockResolvedValue([])

      const result = await buddy.scanForUpdates()

      // Should only check GitHub Actions files
      expect(fetchSpy).toHaveBeenCalledTimes(3) // 3 actions in the workflow file
      expect(result.updates.every(u => u.dependencyType === 'github-actions')).toBe(true)
    })

    it('should determine correct update types', async () => {
      const buddy = new Buddy(mockConfig)

      const actionsFileWithVersions: PackageFile = {
        ...mockGitHubActionsFile,
        dependencies: [
          {
            name: 'actions/checkout',
            currentVersion: '3.0.0',
            type: 'github-actions',
            file: '.github/workflows/ci.yml',
          },
          {
            name: 'oven-sh/setup-bun',
            currentVersion: '1.2.0',
            type: 'github-actions',
            file: '.github/workflows/ci.yml',
          },
          {
            name: 'actions/cache',
            currentVersion: '4.0.0',
            type: 'github-actions',
            file: '.github/workflows/ci.yml',
          },
        ],
      }

      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: '4.0.0' }), // major update
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: '1.3.0' }), // minor update
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: '4.0.1' }), // patch update
        } as Response)

      packageScannerSpy.mockResolvedValue([actionsFileWithVersions])

      registryClientSpy.mockResolvedValue([])

      const result = await buddy.scanForUpdates()

      expect(result.updates).toHaveLength(3)

      // Check update types
      const checkoutUpdate = result.updates.find(u => u.name === 'actions/checkout')
      expect(checkoutUpdate!.updateType).toBe('major')

      const setupBunUpdate = result.updates.find(u => u.name === 'oven-sh/setup-bun')
      expect(setupBunUpdate!.updateType).toBe('minor')

      const cacheUpdate = result.updates.find(u => u.name === 'actions/cache')
      expect(cacheUpdate!.updateType).toBe('patch')
    })

    it('should include proper metadata for GitHub Actions', async () => {
      const buddy = new Buddy(mockConfig)

      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: 'v4.2.2' }),
        } as Response)

      packageScannerSpy.mockResolvedValue([mockGitHubActionsFile])

      registryClientSpy.mockResolvedValue([])

      const result = await buddy.scanForUpdates()

      const checkoutUpdate = result.updates.find(u => u.name === 'actions/checkout')
      expect(checkoutUpdate).toBeTruthy()

      // Check metadata fields
      expect(checkoutUpdate!.releaseNotesUrl).toBe('https://github.com/actions/checkout/releases')
      expect(checkoutUpdate!.homepage).toBe('https://github.com/actions/checkout')
      expect(checkoutUpdate!.changelogUrl).toBeUndefined()
      expect(checkoutUpdate!.metadata).toBeUndefined()
    })
  })

  describe('integration with other update types', () => {
    it('should merge GitHub Actions updates with npm and dependency file updates', async () => {
      const buddy = new Buddy(mockConfig)

      const allFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json' as any,
          content: '{"dependencies": {"lodash": "^4.17.0"}}',
          dependencies: [
            {
              name: 'lodash',
              currentVersion: '^4.17.0',
              type: 'dependencies',
              file: 'package.json',
            },
          ],
        },
        mockGitHubActionsFile,
      ]

      // Mock npm update
      const npmUpdate: PackageUpdate = {
        name: 'lodash',
        currentVersion: '^4.17.0',
        newVersion: '^4.17.21',
        updateType: 'patch',
        dependencyType: 'dependencies',
        file: 'package.json',
      }

      fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: 'v4.2.2' }),
        } as Response) // actions/checkout (has update)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: 'v2' }),
        } as Response) // oven-sh/setup-bun (no update)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tag_name: 'v4.1.0' }),
        } as Response) // actions/cache (no update)

      packageScannerSpy.mockResolvedValue(allFiles)

      registryClientSpy.mockResolvedValue([npmUpdate])

      const result = await buddy.scanForUpdates()

      expect(result.updates).toHaveLength(2) // 1 npm + 1 GitHub Actions (only checkout has update)

      const updateTypes = result.updates.map(u => u.dependencyType)
      expect(updateTypes).toContain('dependencies')
      expect(updateTypes).toContain('github-actions')

      // Verify both updates are properly formed
      const lodashUpdate = result.updates.find(u => u.name === 'lodash')
      expect(lodashUpdate!.file).toBe('package.json')

      const actionUpdate = result.updates.find(u => u.name === 'actions/checkout')
      expect(actionUpdate!.file).toBe('.github/workflows/ci.yml')
    })

    it('should handle empty GitHub Actions files', async () => {
      const buddy = new Buddy(mockConfig)

      const emptyActionsFile: PackageFile = {
        path: '.github/workflows/empty.yml',
        type: 'empty.yml' as any,
        content: 'name: Empty\njobs:\n  test:\n    runs-on: ubuntu-latest',
        dependencies: [], // No uses: statements
      }

      packageScannerSpy.mockResolvedValue([emptyActionsFile])

      registryClientSpy.mockResolvedValue([])

      const result = await buddy.scanForUpdates()

      expect(result.updates).toHaveLength(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
