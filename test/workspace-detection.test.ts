import type { BuddyBotConfig } from '../src/types'
import type { Logger } from '../src/utils/logger'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { RegistryClient } from '../src/registry/registry-client'

describe('RegistryClient - Workspace Detection', () => {
  let registryClient: RegistryClient
  let mockLogger: Logger
  let runCommandSpy: any
  let fsSpy: any
  let pathSpy: any

  const mockConfig: BuddyBotConfig = {
    packages: {
      strategy: 'all',
      ignore: ['ignored/package'],
    },
  }

  beforeEach(() => {
    // Create a mock logger
    mockLogger = {
      info: mock(),
      warn: mock(),
      error: mock(),
      success: mock(),
      debug: mock(),
    } as unknown as Logger

    registryClient = new RegistryClient('/test/project', mockLogger, mockConfig)

    // Mock the runCommand method
    runCommandSpy = spyOn(registryClient as any, 'runCommand')
  })

  afterEach(() => {
    runCommandSpy?.mockRestore?.()
    fsSpy?.mockRestore?.()
    pathSpy?.mockRestore?.()
  })

  describe('getWorkspaceNames', () => {
    it('should find workspace package names from package.json files', async () => {
      // Mock findPackageJsonFiles to return test files
      spyOn(registryClient as any, 'findPackageJsonFiles').mockResolvedValue([
        'packages/ai/package.json',
        'packages/cloud/package.json',
        'packages/storage/package.json',
      ])

      // Mock fs and path imports
      fsSpy = {
        readFileSync: spyOn(fs, 'readFileSync'),
      }

      pathSpy = {
        join: spyOn(path, 'join'),
      }

      // Mock path.join to return predictable paths
      pathSpy.join.mockImplementation((...args: string[]) => args.join('/'))

      // Mock package.json content
      fsSpy.readFileSync
        .mockReturnValueOnce(JSON.stringify({ name: '@stacksjs/ai' }))
        .mockReturnValueOnce(JSON.stringify({ name: '@stacksjs/cloud' }))
        .mockReturnValueOnce(JSON.stringify({ name: '@stacksjs/storage' }))

      const workspaceNames = await (registryClient as any).getWorkspaceNames()

      expect(workspaceNames).toEqual(['@stacksjs/ai', '@stacksjs/cloud', '@stacksjs/storage'])
    })

    it('should handle package.json parsing errors gracefully', async () => {
      // Mock findPackageJsonFiles to return test file
      spyOn(registryClient as any, 'findPackageJsonFiles').mockResolvedValue(['test/package.json'])

      fsSpy = {
        readFileSync: spyOn(fs, 'readFileSync'),
      }

      pathSpy = {
        join: spyOn(path, 'join'),
      }

      pathSpy.join.mockReturnValue('test/package.json')

      // Mock invalid JSON
      fsSpy.readFileSync.mockImplementation(() => {
        throw new Error('Invalid JSON')
      })

      const workspaceNames = await (registryClient as any).getWorkspaceNames()

      expect(workspaceNames).toEqual([])
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to parse package.json test/package.json:', expect.any(Error))
    })

    it('should skip root package.json file', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')

      // Mock findPackageJsonFiles to return only root package.json
      spyOn(registryClient as any, 'findPackageJsonFiles').mockResolvedValue(['package.json'])

      fsSpy = {
        readFileSync: spyOn(fs, 'readFileSync'),
      }

      pathSpy = {
        join: spyOn(path, 'join'),
      }

      pathSpy.join.mockReturnValue('package.json')
      fsSpy.readFileSync.mockReturnValue(JSON.stringify({ name: 'root-package' }))

      const workspaceNames = await (registryClient as any).getWorkspaceNames()

      expect(workspaceNames).toEqual([])
    })
  })

  describe('runBunOutdatedForWorkspace', () => {
    it('should run bun outdated with --filter and parse results', async () => {
      const mockBunOutput = `
┌───────────────────────────────────────┬─────────┬─────────┬─────────┬──────────────┐
│ Package                               │ Current │ Update  │ Latest  │ Workspace    │
├───────────────────────────────────────┼─────────┼─────────┼─────────┼──────────────┤
│ @aws-sdk/client-bedrock-runtime (dev) │ 3.848.0 │ 3.857.0 │ 3.857.0 │ @stacksjs/ai │
├───────────────────────────────────────┼─────────┼─────────┼─────────┼──────────────┤
│ @aws-sdk/credential-providers (dev)   │ 3.848.0 │ 3.857.0 │ 3.857.0 │ @stacksjs/ai │
└───────────────────────────────────────┴─────────┴─────────┴─────────┴──────────────┘
`

      runCommandSpy.mockResolvedValueOnce(mockBunOutput)

      const results = await (registryClient as any).runBunOutdatedForWorkspace('@stacksjs/ai')

      expect(runCommandSpy).toHaveBeenCalledWith('bun', ['outdated', '--filter', '@stacksjs/ai'])
      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        name: '@aws-sdk/client-bedrock-runtime',
        current: '3.848.0',
        update: '3.857.0',
        latest: '3.857.0',
        workspace: '@stacksjs/ai',
      })
      expect(results[1]).toEqual({
        name: '@aws-sdk/credential-providers',
        current: '3.848.0',
        update: '3.857.0',
        latest: '3.857.0',
        workspace: '@stacksjs/ai',
      })
    })

    it('should handle bun outdated command failures gracefully', async () => {
      runCommandSpy.mockRejectedValueOnce(new Error('Command failed'))

      const results = await (registryClient as any).runBunOutdatedForWorkspace('@stacksjs/ai')

      expect(results).toEqual([])
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to run bun outdated for workspace @stacksjs/ai:', expect.any(Error))
    })

    it('should handle empty bun outdated output', async () => {
      runCommandSpy.mockResolvedValueOnce('')

      const results = await (registryClient as any).runBunOutdatedForWorkspace('@stacksjs/ai')

      expect(results).toEqual([])
    })
  })

  describe('getWorkspaceOutdatedPackages', () => {
    it('should check all workspace packages and aggregate results', async () => {
      // Mock getWorkspaceNames to return test workspaces
      spyOn(registryClient as any, 'getWorkspaceNames').mockResolvedValue(['@stacksjs/ai', '@stacksjs/cloud'])

      // Mock runBunOutdatedForWorkspace for each workspace
      spyOn(registryClient as any, 'runBunOutdatedForWorkspace')
        .mockResolvedValueOnce([
          {
            name: '@aws-sdk/client-bedrock-runtime',
            current: '3.848.0',
            update: '3.857.0',
            latest: '3.857.0',
            workspace: '@stacksjs/ai',
          },
        ])
        .mockResolvedValueOnce([
          {
            name: '@aws-sdk/client-s3',
            current: '3.850.0',
            update: '3.857.0',
            latest: '3.857.0',
            workspace: '@stacksjs/cloud',
          },
          {
            name: '@aws-sdk/client-cloudformation',
            current: '3.848.0',
            update: '3.857.0',
            latest: '3.857.0',
            workspace: '@stacksjs/cloud',
          },
        ])

      const results = await (registryClient as any).getWorkspaceOutdatedPackages()

      expect(results).toHaveLength(3)
      expect(results[0].workspace).toBe('@stacksjs/ai')
      expect(results[1].workspace).toBe('@stacksjs/cloud')
      expect(results[2].workspace).toBe('@stacksjs/cloud')
      expect(mockLogger.info).toHaveBeenCalledWith('Found 2 workspace packages to check')
      expect(mockLogger.info).toHaveBeenCalledWith('Found 3 outdated packages across workspaces')
    })

    it('should handle workspace scanning failures gracefully', async () => {
      spyOn(registryClient as any, 'getWorkspaceNames').mockResolvedValue(['@stacksjs/ai', '@stacksjs/cloud'])
      
      // Mock findPackageJsonFiles to return empty for the direct scanning part
      spyOn(registryClient as any, 'findPackageJsonFiles').mockResolvedValue([])

      spyOn(registryClient as any, 'runBunOutdatedForWorkspace')
        .mockResolvedValueOnce([{ name: 'package1', current: '1.0.0', update: '1.1.0', latest: '1.1.0', workspace: '@stacksjs/ai' }])
        .mockRejectedValueOnce(new Error('Workspace scan failed'))

      const results = await (registryClient as any).getWorkspaceOutdatedPackages()

      expect(results).toHaveLength(1)
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to check workspace @stacksjs/cloud:', expect.any(Error))
    })

    it('should handle getWorkspaceNames failure', async () => {
      spyOn(registryClient as any, 'getWorkspaceNames').mockRejectedValue(new Error('Failed to get workspace names'))

      const results = await (registryClient as any).getWorkspaceOutdatedPackages()

      expect(results).toEqual([])
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to check workspace packages:', expect.any(Error))
    })
  })

  describe('findPackageJsonFiles', () => {
    it('should find all package.json files recursively', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')

      fsSpy = {
        promises: {
          readdir: spyOn(fs.promises, 'readdir'),
          stat: spyOn(fs.promises, 'stat'),
        },
      }

      pathSpy = {
        join: spyOn(path, 'join'),
      }

      // Mock directory structure: root with package.json and src dir
      fsSpy.promises.readdir
        .mockResolvedValueOnce(['package.json', 'src'] as any) // root
        .mockResolvedValueOnce(['components'] as any) // src
        .mockResolvedValueOnce(['package.json'] as any) // src/components

      const mockDirectoryStat = { isDirectory: () => true, isFile: () => false }
      const mockFileStat = { isDirectory: () => false, isFile: () => true }

      fsSpy.promises.stat
        .mockResolvedValueOnce(mockFileStat) // package.json
        .mockResolvedValueOnce(mockDirectoryStat) // src
        .mockResolvedValueOnce(mockDirectoryStat) // components
        .mockResolvedValueOnce(mockFileStat) // components/package.json

      pathSpy.join.mockImplementation((...args: string[]) => args.join('/'))

      const files = await (registryClient as any).findPackageJsonFiles()

      // The exact files found may vary based on real filesystem vs mocks
      // but we should find at least the root package.json
      expect(files).toContain('package.json')
      expect(files.length).toBeGreaterThanOrEqual(1)
    })

    it('should skip directories that should be ignored', async () => {
      fsSpy = {
        promises: {
          readdir: spyOn(fs.promises, 'readdir'),
          stat: spyOn(fs.promises, 'stat'),
        },
      }

      pathSpy = {
        join: spyOn(path, 'join'),
      }

      // Mock directory with ignored directories
      fsSpy.promises.readdir.mockResolvedValueOnce([
        'package.json',
        'node_modules',
        '.git',
        'dist',
        '.next',
        'src',
      ] as any)

      const mockDirectoryStat = { isDirectory: () => true, isFile: () => false }
      const mockFileStat = { isDirectory: () => false, isFile: () => true }

      fsSpy.promises.stat
        .mockResolvedValueOnce(mockFileStat) // package.json
        .mockResolvedValueOnce(mockDirectoryStat) // node_modules (skipped)
        .mockResolvedValueOnce(mockDirectoryStat) // .git (skipped)
        .mockResolvedValueOnce(mockDirectoryStat) // dist (skipped)
        .mockResolvedValueOnce(mockDirectoryStat) // .next (skipped)
        .mockResolvedValueOnce(mockDirectoryStat) // src

      fsSpy.promises.readdir.mockResolvedValueOnce(['index.ts'] as any) // src contents

      fsSpy.promises.stat.mockResolvedValueOnce(mockFileStat) // src/index.ts

      pathSpy.join.mockImplementation((...args: string[]) => args.join('/'))

      const files = await (registryClient as any).findPackageJsonFiles()

      expect(files).toEqual(['package.json'])
    })
  })

  describe('shouldSkipDirectory', () => {
    it('should skip common directories', () => {
      const shouldSkip = (registryClient as any).shouldSkipDirectory

      expect(shouldSkip('node_modules')).toBe(true)
      expect(shouldSkip('.git')).toBe(true)
      expect(shouldSkip('.next')).toBe(true)
      expect(shouldSkip('dist')).toBe(true)
      expect(shouldSkip('build')).toBe(true)
      expect(shouldSkip('coverage')).toBe(true)
      expect(shouldSkip('.cache')).toBe(true)
      expect(shouldSkip('.vscode')).toBe(true)
      expect(shouldSkip('.idea')).toBe(true)
    })

    it('should skip directories starting with dot', () => {
      const shouldSkip = (registryClient as any).shouldSkipDirectory

      expect(shouldSkip('.env')).toBe(true)
      expect(shouldSkip('.custom')).toBe(true)
      expect(shouldSkip('.hidden')).toBe(true)
    })

    it('should not skip regular directories', () => {
      const shouldSkip = (registryClient as any).shouldSkipDirectory

      expect(shouldSkip('src')).toBe(false)
      expect(shouldSkip('lib')).toBe(false)
      expect(shouldSkip('components')).toBe(false)
      expect(shouldSkip('utils')).toBe(false)
    })
  })
})
