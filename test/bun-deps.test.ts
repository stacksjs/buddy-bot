import type { BuddyBotConfig } from '../src/types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buddy } from '../src/buddy'

// Mock the ts-pkgx module to return our test dependencies
const mockResolveDependencyFile = mock(() => Promise.resolve({
  allDependencies: [
    {
      name: 'bun.sh',
      constraint: '1.0.0',
      version: '1.2.0',
      isOsSpecific: false,
    },
    {
      name: 'some-other-package',
      constraint: '^1.2.3',
      version: '1.2.3',
      isOsSpecific: false,
    },
  ],
  uniquePackages: ['bun.sh'],
  conflicts: {},
  osSpecificDeps: {},
}))

// Mock the file system functions
const mockReadFile = mock(async () => `dependencies:\n  bun.sh: 1.0.0\n  some-other-package: ^1.2.3\n`)

// Mock the logger
const mockLogger = {
  info: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  warn: mock(() => {}),
  log: mock(() => {}),
  dir: mock(() => {}),
  time: mock(() => {}),
  timeEnd: mock(() => {}),
  timeLog: mock(() => {}),
  trace: mock(() => {}),
  table: mock(() => {}),
}

describe('Bun deps.yaml Update Tests', () => {
  let testDir: string
  let originalCwd: string
  let config: BuddyBotConfig

  beforeAll(async () => {
    // Create a temporary directory for testing
    testDir = await mkdtemp(join(tmpdir(), 'buddy-test-'))
    originalCwd = process.cwd()
    process.chdir(testDir)

    // Create a basic package.json file
    await writeFile(
      join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          // Add some dummy dependencies to make bun happy
          typescript: '^5.0.0',
        },
      }, null, 2),
    )

    // Create an empty bun.lockb file
    await writeFile(join(testDir, 'bun.lockb'), '')

    // Create a basic deps.yaml file
    await writeFile(
      join(testDir, 'deps.yaml'),
      `dependencies:
  bun.sh: 1.0.0
  some-other-package: ^1.2.3
`,
    )

    // Create a basic buddy-bot.config.ts file
    config = {
      repository: {
        provider: 'github' as const,
        owner: 'test-owner',
        name: 'test-repo',
        baseBranch: 'main',
        token: 'test-token',
      },
      // @ts-expect-error - Using partial config for testing
      updates: {
        strategy: 'all',
        schedule: '0 0 * * *',
        autoMerge: false,
        autoApprove: false,
        maxConcurrentUpdates: 5,
        ignorePatterns: [],
        updateTypes: ['major', 'minor', 'patch'] as const,
        commitMessage: 'chore(deps): update {{name}} from {{currentVersion}} to {{newVersion}}',
        branchName: 'buddy/update-{{name}}-{{newVersion}}',
        prTitle: 'chore(deps): update {{name}} from {{currentVersion}} to {{newVersion}}',
        prBody: 'This PR updates {{name}} from {{currentVersion}} to {{newVersion}}.',
        labels: ['dependencies'],
        assignees: [],
        reviewers: [],
        requireCodeOwnerReviews: false,
        draft: false,
      },
    }
  })

  afterAll(async () => {
    // Clean up
    process.chdir(originalCwd)
    await rm(testDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    // Clear all mocks before each test
    mock.restore()
  })

  afterEach(() => {
    // Clear all mocks after each test
    mock.restore()
  })

  test('should include Bun update in file updates', async () => {
    // Mock the ts-pkgx module
    mock.module('ts-pkgx', () => ({
      resolveDependencyFile: mockResolveDependencyFile,
    }))

    // Create a test instance of Buddy
    const buddy = new Buddy(config, testDir)

    // Mock the registry client methods to avoid actual command execution
    const registryClient = (buddy as any).registryClient
    if (registryClient) {
      // Mock all the methods that getOutdatedPackages calls
      spyOn(registryClient, 'runBunOutdated').mockResolvedValue([])
      spyOn(registryClient, 'getWorkspaceOutdatedPackages').mockResolvedValue([])
      spyOn(registryClient, 'getPackageJsonOutdated').mockResolvedValue([])
      spyOn(registryClient, 'getComposerOutdatedPackages').mockResolvedValue([])
    }

    // Run a scan to get updates
    const scanResult = await buddy.scanForUpdates()

    // Check that we found updates from dependency files
    const depsYamlUpdate = scanResult.updates.find(update =>
      update.file.includes('deps.yaml') && update.name === 'bun.sh',
    )

    expect(depsYamlUpdate).toBeDefined()
    expect(depsYamlUpdate?.name).toBe('bun.sh')
    expect(depsYamlUpdate?.currentVersion).toBe('1.0.0')
    expect(depsYamlUpdate?.newVersion).toBe('1.2.0')
  })
})
