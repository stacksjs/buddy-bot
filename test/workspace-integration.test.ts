import type { BuddyBotConfig } from '../src/types'
import type { Logger } from '../src/utils/logger'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { RegistryClient } from '../src/registry/registry-client'

describe('RegistryClient - Workspace Integration', () => {
  let registryClient: RegistryClient
  let mockLogger: Logger
  let runCommandSpy: any
  let fsSpy: any
  let pathSpy: any
  let fetchSpy: any

  const mockConfig: BuddyBotConfig = {
    packages: {
      strategy: 'all',
      ignore: [],
    },
  }

  beforeEach(() => {
    mockLogger = {
      info: mock(),
      warn: mock(),
      error: mock(),
      success: mock(),
      debug: mock(),
    } as unknown as Logger

    registryClient = new RegistryClient('/test/monorepo', mockLogger, mockConfig)

    runCommandSpy = spyOn(registryClient as any, 'runCommand')
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    runCommandSpy?.mockRestore?.()
    fsSpy?.mockRestore?.()
    pathSpy?.mockRestore?.()
    fetchSpy?.mockRestore?.()
  })

  describe('getOutdatedPackages with workspace support', () => {
    it('should integrate workspace updates with regular bun outdated', async () => {
      // Mock root bun outdated (returns empty)
      runCommandSpy.mockResolvedValueOnce('')

      // Mock workspace detection
      spyOn(registryClient as any, 'getWorkspaceOutdatedPackages').mockResolvedValue([
        {
          name: '@aws-sdk/client-s3',
          current: '3.848.0',
          update: '3.857.0',
          latest: '3.857.0',
          workspace: '@stacksjs/cloud',
        },
        {
          name: '@aws-sdk/client-bedrock',
          current: '3.848.0',
          update: '3.857.0',
          latest: '3.857.0',
          workspace: '@stacksjs/ai',
        },
      ])

      // Mock package.json outdated check
      spyOn(registryClient as any, 'getPackageJsonOutdated').mockResolvedValue([])

      // Mock metadata fetching
      spyOn(registryClient as any, 'getPackageMetadata').mockResolvedValue({
        name: 'test-package',
        latestVersion: '1.0.0',
        versions: ['1.0.0'],
      })

      const updates = await registryClient.getOutdatedPackages()

      expect(updates).toHaveLength(2)
      expect(updates[0].name).toBe('@aws-sdk/client-s3')
      expect(updates[0].currentVersion).toBe('3.848.0')
      expect(updates[0].newVersion).toBe('3.857.0')
      expect(updates[1].name).toBe('@aws-sdk/client-bedrock')
      expect(mockLogger.success).toHaveBeenCalledWith('Found 2 package updates')
    })

    it('should merge workspace updates with root package updates', async () => {
      // Mock root bun outdated (returns one package)
      const rootBunOutput = `
┌─────────┬─────────┬─────────┬─────────┐
│ Package │ Current │ Update  │ Latest  │
├─────────┼─────────┼─────────┼─────────┤
│ lodash  │ 4.17.20 │ 4.17.21 │ 4.17.21 │
└─────────┴─────────┴─────────┴─────────┘
`
      runCommandSpy.mockResolvedValueOnce(rootBunOutput)

      // Mock workspace updates
      spyOn(registryClient as any, 'getWorkspaceOutdatedPackages').mockResolvedValue([
        {
          name: '@aws-sdk/client-s3',
          current: '3.848.0',
          update: '3.857.0',
          latest: '3.857.0',
          workspace: '@stacksjs/cloud',
        },
      ])

      // Mock package.json outdated check
      spyOn(registryClient as any, 'getPackageJsonOutdated').mockResolvedValue([])

      // Mock metadata fetching
      spyOn(registryClient as any, 'getPackageMetadata').mockResolvedValue({
        name: 'test-package',
        latestVersion: '1.0.0',
        versions: ['1.0.0'],
      })

      const updates = await registryClient.getOutdatedPackages()

      expect(updates).toHaveLength(2)

      // Should include both root and workspace packages
      const packageNames = updates.map(u => u.name)
      expect(packageNames).toContain('lodash')
      expect(packageNames).toContain('@aws-sdk/client-s3')
    })

    it('should prioritize root bun outdated over workspace results for same package', async () => {
      // Mock root bun outdated with a package
      const rootBunOutput = `
┌─────────────────┬─────────┬─────────┬─────────┐
│ Package         │ Current │ Update  │ Latest  │
├─────────────────┼─────────┼─────────┼─────────┤
│ @aws-sdk/client │ 3.840.0 │ 3.855.0 │ 3.855.0 │
└─────────────────┴─────────┴─────────┴─────────┘
`
      runCommandSpy.mockResolvedValueOnce(rootBunOutput)

      // Mock workspace updates with same package but different version info
      spyOn(registryClient as any, 'getWorkspaceOutdatedPackages').mockResolvedValue([
        {
          name: '@aws-sdk/client',
          current: '3.848.0',
          update: '3.857.0',
          latest: '3.857.0',
          workspace: '@stacksjs/cloud',
        },
      ])

      spyOn(registryClient as any, 'getPackageJsonOutdated').mockResolvedValue([])
      spyOn(registryClient as any, 'getPackageMetadata').mockResolvedValue({
        name: 'test-package',
        latestVersion: '1.0.0',
        versions: ['1.0.0'],
      })

      const updates = await registryClient.getOutdatedPackages()

      expect(updates).toHaveLength(1)
      expect(updates[0].name).toBe('@aws-sdk/client')
      // Should use root bun outdated version info
      expect(updates[0].currentVersion).toBe('3.840.0')
      expect(updates[0].newVersion).toBe('3.855.0')
    })

    it('should handle workspace detection errors gracefully', async () => {
      runCommandSpy.mockResolvedValueOnce('')

      // Mock workspace detection failure with spy that returns empty array
      spyOn(registryClient as any, 'getWorkspaceOutdatedPackages').mockResolvedValue([])

      spyOn(registryClient as any, 'getPackageJsonOutdated').mockResolvedValue([])

      // Also need to mock the metadata fetching
      spyOn(registryClient as any, 'getPackageMetadata').mockResolvedValue({
        name: 'test-package',
        latestVersion: '1.0.0',
        versions: ['1.0.0'],
      })

      const updates = await registryClient.getOutdatedPackages()

      expect(updates).toEqual([])
      expect(mockLogger.success).toHaveBeenCalledWith('Found 0 package updates')
    })

    it('should include package.json fallback packages not found in workspace scan', async () => {
      runCommandSpy.mockResolvedValueOnce('')

      spyOn(registryClient as any, 'getWorkspaceOutdatedPackages').mockResolvedValue([
        {
          name: '@aws-sdk/client-s3',
          current: '3.848.0',
          update: '3.857.0',
          latest: '3.857.0',
          workspace: '@stacksjs/cloud',
        },
      ])

      // Mock package.json outdated check finds a different package
      spyOn(registryClient as any, 'getPackageJsonOutdated').mockResolvedValue([
        {
          name: 'typescript',
          current: '5.8.2',
          update: '5.8.3',
          latest: '5.8.3',
        },
      ])

      spyOn(registryClient as any, 'getPackageMetadata').mockResolvedValue({
        name: 'test-package',
        latestVersion: '1.0.0',
        versions: ['1.0.0'],
      })

      const updates = await registryClient.getOutdatedPackages()

      expect(updates).toHaveLength(2)
      const packageNames = updates.map(u => u.name)
      expect(packageNames).toContain('@aws-sdk/client-s3')
      expect(packageNames).toContain('typescript')
    })
  })

  describe('workspace parsing with different output formats', () => {
    it('should parse workspace output with Unicode box-drawing characters', async () => {
      const mockBunOutput = `
┌───────────────────────────────────────┬─────────┬─────────┬─────────┬──────────────┐
│ Package                               │ Current │ Update  │ Latest  │ Workspace    │
├───────────────────────────────────────┼─────────┼─────────┼─────────┼──────────────┤
│ @aws-sdk/client-bedrock-runtime (dev) │ 3.848.0 │ 3.857.0 │ 3.857.0 │ @stacksjs/ai │
│ @aws-sdk/credential-providers (dev)   │ 3.848.0 │ 3.857.0 │ 3.857.0 │ @stacksjs/ai │
└───────────────────────────────────────┴─────────┴─────────┴─────────┴──────────────┘
`

      runCommandSpy.mockResolvedValueOnce(mockBunOutput)

      const results = await (registryClient as any).runBunOutdatedForWorkspace('@stacksjs/ai')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        name: '@aws-sdk/client-bedrock-runtime',
        current: '3.848.0',
        update: '3.857.0',
        latest: '3.857.0',
        workspace: '@stacksjs/ai',
      })
    })

    it('should parse workspace output with pipe separators', async () => {
      const mockBunOutput = `
| Package                               | Current | Update  | Latest  | Workspace    |
| @aws-sdk/client-bedrock-runtime (dev) | 3.848.0 | 3.857.0 | 3.857.0 | @stacksjs/ai |
`

      runCommandSpy.mockResolvedValueOnce(mockBunOutput)

      const results = await (registryClient as any).runBunOutdatedForWorkspace('@stacksjs/ai')

      expect(results).toHaveLength(1)
      expect(results[0].workspace).toBe('@stacksjs/ai')
    })

    it('should handle output without workspace column (fallback)', async () => {
      const mockBunOutput = `
┌─────────────────────────────────────┬─────────┬─────────┬─────────┐
│ Package                             │ Current │ Update  │ Latest  │
├─────────────────────────────────────┼─────────┼─────────┼─────────┤
│ @aws-sdk/client-bedrock-runtime     │ 3.848.0 │ 3.857.0 │ 3.857.0 │
└─────────────────────────────────────┴─────────┴─────────┴─────────┘
`

      runCommandSpy.mockResolvedValueOnce(mockBunOutput)

      const results = await (registryClient as any).runBunOutdatedForWorkspace('@stacksjs/ai')

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        name: '@aws-sdk/client-bedrock-runtime',
        current: '3.848.0',
        update: '3.857.0',
        latest: '3.857.0',
        workspace: '@stacksjs/ai', // Added by runBunOutdatedForWorkspace
      })
    })
  })

  describe('performance and edge cases', () => {
    it('should handle large number of workspaces efficiently', async () => {
      const workspaces = Array.from({ length: 50 }, (_, i) => `@test/package-${i}`)

      spyOn(registryClient as any, 'getWorkspaceNames').mockResolvedValue(workspaces)

      // Mock each workspace returning one outdated package
      const runWorkspaceSpy = spyOn(registryClient as any, 'runBunOutdatedForWorkspace')
      workspaces.forEach((workspace, i) => {
        runWorkspaceSpy.mockResolvedValueOnce([
          {
            name: `package-${i}`,
            current: '1.0.0',
            update: '1.1.0',
            latest: '1.1.0',
            workspace,
          },
        ])
      })

      const results = await (registryClient as any).getWorkspaceOutdatedPackages()

      expect(results).toHaveLength(50)
      expect(mockLogger.info).toHaveBeenCalledWith('Found 50 workspace packages to check')
      expect(mockLogger.info).toHaveBeenCalledWith('Found 50 outdated packages across workspaces')
    })

    it('should handle workspaces with no outdated packages', async () => {
      spyOn(registryClient as any, 'getWorkspaceNames').mockResolvedValue(['@stacksjs/ai', '@stacksjs/cloud'])

      spyOn(registryClient as any, 'runBunOutdatedForWorkspace')
        .mockResolvedValueOnce([]) // No updates in first workspace
        .mockResolvedValueOnce([]) // No updates in second workspace

      const results = await (registryClient as any).getWorkspaceOutdatedPackages()

      expect(results).toHaveLength(0)
      expect(mockLogger.info).toHaveBeenCalledWith('Found 0 outdated packages across workspaces')
    })

    it('should handle mixed success and failure across workspaces', async () => {
      spyOn(registryClient as any, 'getWorkspaceNames').mockResolvedValue(['@stacksjs/working', '@stacksjs/broken', '@stacksjs/empty'])

      const runWorkspaceSpy = spyOn(registryClient as any, 'runBunOutdatedForWorkspace')

      // First workspace succeeds
      runWorkspaceSpy.mockResolvedValueOnce([
        {
          name: 'working-package',
          current: '1.0.0',
          update: '1.1.0',
          latest: '1.1.0',
          workspace: '@stacksjs/working',
        },
      ])

      // Second workspace fails
      runWorkspaceSpy.mockRejectedValueOnce(new Error('Workspace error'))

      // Third workspace succeeds but empty
      runWorkspaceSpy.mockResolvedValueOnce([])

      const results = await (registryClient as any).getWorkspaceOutdatedPackages()

      expect(results).toHaveLength(1)
      expect(results[0].workspace).toBe('@stacksjs/working')
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to check workspace @stacksjs/broken:', expect.any(Error))
    })
  })
})
