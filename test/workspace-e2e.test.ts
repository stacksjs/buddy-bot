import { Logger } from '../src/utils/logger'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RegistryClient } from '../src/registry/registry-client'

describe('Workspace Detection - End-to-End Tests', () => {
  let tempDir: string
  let mockLogger: Logger

  beforeEach(async () => {
    // Create a fresh temporary directory for each test
    tempDir = await mkdtemp(join(tmpdir(), 'buddy-bot-workspace-test-'))

    mockLogger = new Logger(false)

    // Create a realistic monorepo structure
    await createTestMonorepo(tempDir)
  })

  afterEach(async () => {
    // Clean up temporary directory after each test
    await rm(tempDir, { recursive: true, force: true })
  })

  async function createTestMonorepo(baseDir: string) {
    // Root package.json
    await writeFile(join(baseDir, 'package.json'), JSON.stringify({
      name: 'test-monorepo',
      private: true,
      workspaces: [
        'packages/*',
        'apps/*',
      ],
      devDependencies: {
        'typescript': '5.8.2',
        'buddy-bot': '0.4.4',
      },
    }, null, 2))

    // Create packages directory structure
    await mkdir(join(baseDir, 'packages'), { recursive: true })
    await mkdir(join(baseDir, 'packages', 'ui'), { recursive: true })
    await mkdir(join(baseDir, 'packages', 'utils'), { recursive: true })
    await mkdir(join(baseDir, 'apps'), { recursive: true })
    await mkdir(join(baseDir, 'apps', 'web'), { recursive: true })

    // packages/ui/package.json
    await writeFile(join(baseDir, 'packages', 'ui', 'package.json'), JSON.stringify({
      name: '@test/ui',
      version: '1.0.0',
      dependencies: {
        react: '18.2.0',
        lodash: '4.17.20',
      },
      devDependencies: {
        '@types/react': '18.0.0',
        '@aws-sdk/client-s3': '3.848.0',
      },
    }, null, 2))

    // packages/utils/package.json
    await writeFile(join(baseDir, 'packages', 'utils', 'package.json'), JSON.stringify({
      name: '@test/utils',
      version: '1.0.0',
      dependencies: {
        axios: '0.27.0',
      },
      devDependencies: {
        '@aws-sdk/client-dynamodb': '3.848.0',
        '@aws-sdk/lib-dynamodb': '3.848.0',
      },
    }, null, 2))

    // apps/web/package.json
    await writeFile(join(baseDir, 'apps', 'web', 'package.json'), JSON.stringify({
      name: '@test/web',
      version: '1.0.0',
      dependencies: {
        '@test/ui': 'workspace:*',
        '@test/utils': 'workspace:*',
        'next': '13.5.0',
      },
      devDependencies: {
        '@aws-sdk/client-bedrock': '3.848.0',
      },
    }, null, 2))

    // Create node_modules directory (should be ignored)
    await mkdir(join(baseDir, 'node_modules'), { recursive: true })
    await writeFile(join(baseDir, 'node_modules', 'package.json'), JSON.stringify({
      name: 'should-be-ignored',
    }))

    // Create .git directory (should be ignored)
    await mkdir(join(baseDir, '.git'), { recursive: true })
  }

  it('should discover all workspace packages in monorepo structure', async () => {
    const registryClient = new RegistryClient(tempDir, mockLogger)

    const workspaceNames = await (registryClient as any).getWorkspaceNames()

    expect(workspaceNames).toHaveLength(3)
    expect(workspaceNames).toContain('@test/ui')
    expect(workspaceNames).toContain('@test/utils')
    expect(workspaceNames).toContain('@test/web')
  })

  it('should find all package.json files while ignoring system directories', async () => {
    const registryClient = new RegistryClient(tempDir, mockLogger)

    const packageJsonFiles = await (registryClient as any).findPackageJsonFiles()

    expect(packageJsonFiles).toHaveLength(4)
    expect(packageJsonFiles).toContain('package.json')
    expect(packageJsonFiles).toContain('packages/ui/package.json')
    expect(packageJsonFiles).toContain('packages/utils/package.json')
    expect(packageJsonFiles).toContain('apps/web/package.json')

    // Should not include node_modules
    expect(packageJsonFiles).not.toContain('node_modules/package.json')
  })

  it('should handle nested workspace structures', async () => {
    // Create a deeper nested structure
    await mkdir(join(tempDir, 'packages', 'ui', 'components'), { recursive: true })
    await writeFile(join(tempDir, 'packages', 'ui', 'components', 'package.json'), JSON.stringify({
      name: '@test/ui-components',
      version: '1.0.0',
      dependencies: {
        react: '18.2.0',
      },
    }, null, 2))

    const registryClient = new RegistryClient(tempDir, mockLogger)
    const workspaceNames = await (registryClient as any).getWorkspaceNames()

    expect(workspaceNames).toContain('@test/ui-components')
  })

  it('should handle package.json files without name field', async () => {
    // Create a package.json without name field
    await mkdir(join(tempDir, 'invalid-package'), { recursive: true })
    await writeFile(join(tempDir, 'invalid-package', 'package.json'), JSON.stringify({
      version: '1.0.0',
      dependencies: {},
    }, null, 2))

    const registryClient = new RegistryClient(tempDir, mockLogger)
    const workspaceNames = await (registryClient as any).getWorkspaceNames()

    // Should not include packages without names
    expect(workspaceNames).not.toContain(undefined)
    expect(workspaceNames).not.toContain('')
  })

  it('should handle malformed package.json files gracefully', async () => {
    // Create a malformed package.json
    await mkdir(join(tempDir, 'malformed-package'), { recursive: true })
    await writeFile(join(tempDir, 'malformed-package', 'package.json'), '{ invalid json }')

    const registryClient = new RegistryClient(tempDir, mockLogger)

    // Should not throw error
    const workspaceNames = await (registryClient as any).getWorkspaceNames()

    // Should still find the valid packages
    expect(workspaceNames.length).toBeGreaterThan(0)
    expect(workspaceNames).toContain('@test/ui')
  })

  it('should work with different directory structures', async () => {
    // Test with a different structure - libs instead of packages
    await mkdir(join(tempDir, 'libs'), { recursive: true })
    await mkdir(join(tempDir, 'libs', 'shared'), { recursive: true })

    await writeFile(join(tempDir, 'libs', 'shared', 'package.json'), JSON.stringify({
      name: '@test/shared',
      version: '1.0.0',
      dependencies: {
        uuid: '9.0.0',
      },
    }, null, 2))

    const registryClient = new RegistryClient(tempDir, mockLogger)
    const workspaceNames = await (registryClient as any).getWorkspaceNames()

    expect(workspaceNames).toContain('@test/shared')
  })

  it('should respect shouldSkipDirectory rules', async () => {
    // Create directories that should be skipped
    const skipDirs = ['.next', 'dist', 'build', 'coverage', '.cache', '.vscode']

    for (const dir of skipDirs) {
      await mkdir(join(tempDir, dir), { recursive: true })
      await writeFile(join(tempDir, dir, 'package.json'), JSON.stringify({
        name: `@should-skip/${dir}`,
        version: '1.0.0',
      }, null, 2))
    }

    const registryClient = new RegistryClient(tempDir, mockLogger)
    const workspaceNames = await (registryClient as any).getWorkspaceNames()

    // Should not find any packages in skipped directories
    for (const dir of skipDirs) {
      expect(workspaceNames).not.toContain(`@should-skip/${dir}`)
    }
  })

  it('should handle empty directories gracefully', async () => {
    // Create empty directories
    await mkdir(join(tempDir, 'empty-dir'), { recursive: true })
    await mkdir(join(tempDir, 'another-empty'), { recursive: true })

    const registryClient = new RegistryClient(tempDir, mockLogger)

    // Should not throw errors
    const workspaceNames = await (registryClient as any).getWorkspaceNames()
    const packageFiles = await (registryClient as any).findPackageJsonFiles()

    expect(workspaceNames).toBeInstanceOf(Array)
    expect(packageFiles).toBeInstanceOf(Array)
  })

  it('should handle permission errors gracefully', async () => {
    const registryClient = new RegistryClient('/non-existent-directory', mockLogger)

    // Should not throw errors when directory doesn't exist
    const workspaceNames = await (registryClient as any).getWorkspaceNames()
    const packageFiles = await (registryClient as any).findPackageJsonFiles()

    expect(workspaceNames).toEqual([])
    expect(packageFiles).toEqual([])
  })
})
