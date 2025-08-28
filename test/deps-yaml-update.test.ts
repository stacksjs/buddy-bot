import type { BuddyBotConfig } from '../src/types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buddy } from '../src/buddy'
import { RegistryClient } from '../src/registry/registry-client'

// Import the module to spy on
const tsPkgx = await import('ts-pkgx')

// Create spy functions
let mockResolveDependencyFile: any
let mockGetOutdatedPackages: any
let mockGetPackageMetadata: any

describe('Bun deps.yaml Update Tests', () => {
  let testDir: string
  let originalCwd: string
  let config: BuddyBotConfig

  beforeAll(async () => {
    // Create a temporary directory for testing
    testDir = await mkdtemp(join(tmpdir(), 'buddy-test-'))
    originalCwd = process.cwd()
    process.chdir(testDir)

    // Create a basic deps.yaml file that matches the actual structure
    await writeFile(
      join(testDir, 'deps.yaml'),
      `dependencies:
  bun.sh: ^1.2.20
  some-other-package: ^1.2.3
`,
    )

    // Setup config
    config = {
      packages: {
        strategy: 'patch',
        respectLatest: true,
      },
      repository: {
        provider: 'github',
        owner: 'test',
        name: 'test-repo',
      },
      pullRequest: {
        reviewers: [],
        assignees: [],
      },
    }
  })

  afterAll(async () => {
    // Clean up
    process.chdir(originalCwd)
    await rm(testDir, { recursive: true, force: true })
  })

  // Setup fresh mocks before each test
  beforeEach(() => {
    // Clear any existing global module mocks first
    if (typeof mock !== 'undefined' && mock.restore) {
      mock.restore()
    }

    // Setup spies for RegistryClient methods
    mockGetOutdatedPackages = spyOn(RegistryClient.prototype, 'getOutdatedPackages').mockImplementation(() =>
      Promise.resolve([
        {
          name: 'bun.sh',
          currentVersion: '^1.2.20',
          newVersion: '1.2.21',
          updateType: 'patch' as const,
          dependencyType: 'dependencies' as const,
          file: 'deps.yaml',
          metadata: undefined,
          releaseNotesUrl: undefined,
          changelogUrl: undefined,
          homepage: undefined,
        },
      ]),
    )

    mockGetPackageMetadata = spyOn(RegistryClient.prototype, 'getPackageMetadata').mockImplementation(() =>
      Promise.resolve({
        name: 'bun.sh',
        description: 'Fast JavaScript runtime',
        repository: undefined,
        homepage: undefined,
        license: undefined,
        author: undefined,
        keywords: undefined,
        latestVersion: '1.2.21',
        versions: ['1.2.20', '1.2.21'],
        weeklyDownloads: undefined,
        dependencies: undefined,
        devDependencies: undefined,
        peerDependencies: undefined,
      }),
    )

    // Setup spy for ts-pkgx's resolveDependencyFile
    mockResolveDependencyFile = spyOn(tsPkgx, 'resolveDependencyFile').mockImplementation(async () => ({
      allDependencies: [
        {
          name: 'bun.sh',
          constraint: '^1.2.20',
          version: '1.2.21',
          isOsSpecific: false,
        },
      ],
      uniquePackages: ['bun.sh'],
      conflicts: [],
      osSpecificDeps: {},
    }))
  })

  // Clean up mocks after each test
  afterEach(() => {
    if (mockResolveDependencyFile)
      mockResolveDependencyFile.mockRestore()
    if (mockGetOutdatedPackages)
      mockGetOutdatedPackages.mockRestore()
    if (mockGetPackageMetadata)
      mockGetPackageMetadata.mockRestore()
  })

  test('should detect Bun version in deps.yaml', async () => {
    // Setup mocks for this specific test
    mockGetOutdatedPackages.mockResolvedValue([
      {
        name: 'bun.sh',
        currentVersion: '^1.2.20',
        newVersion: '1.2.21',
        updateType: 'patch' as const,
        dependencyType: 'dependencies' as const,
        file: 'deps.yaml',
        metadata: undefined,
        releaseNotesUrl: undefined,
        changelogUrl: undefined,
        homepage: undefined,
      },
    ])

    const buddy = new Buddy(config, testDir)
    const scanResult = await buddy.scanForUpdates()

    // Verify that the Bun update was detected
    let hasBunUpdate = false
    for (const update of scanResult.updates) {
      if (update.name === 'bun.sh') {
        hasBunUpdate = true
        expect(update.currentVersion).toBe('^1.2.20')
        expect(update.newVersion).toBe('1.2.21')
        expect(update.file).toMatch(/deps\.ya?ml$/i)
        break
      }
    }
    expect(hasBunUpdate).toBe(true)
  })

  test('should include Bun update in file updates', async () => {
    // Setup mock for this specific test
    mockGetOutdatedPackages.mockResolvedValue([
      {
        name: 'bun.sh',
        currentVersion: '^1.2.20',
        newVersion: '1.2.21',
        updateType: 'patch' as const,
        dependencyType: 'dependencies' as const,
        file: 'deps.yaml',
        metadata: undefined,
        releaseNotesUrl: undefined,
        changelogUrl: undefined,
        homepage: undefined,
      },
    ])

    const buddy = new Buddy(config, testDir)
    const scanResult = await buddy.scanForUpdates()
    const fileUpdates = await buddy.generateAllFileUpdates(scanResult.updates)

    // Verify that the Bun update is included in file updates
    let foundDepsYamlUpdate = false
    for (const update of fileUpdates) {
      if ('path' in update && update.path.endsWith('deps.yaml')) {
        foundDepsYamlUpdate = true
        expect(update.content).toContain('bun.sh: ^1.2.21')
        break
      }
    }
    expect(foundDepsYamlUpdate).toBe(true)
  })

  test('should handle case-insensitive filenames', async () => {
    // Setup mock to return updates for this test
    mockGetOutdatedPackages.mockResolvedValueOnce([
      {
        name: 'bun.sh',
        currentVersion: '^1.2.20',
        newVersion: '1.2.21',
        updateType: 'patch' as const,
        dependencyType: 'dependencies' as const,
        file: 'deps.yaml',
        metadata: undefined,
        releaseNotesUrl: undefined,
        changelogUrl: undefined,
        homepage: undefined,
      },
    ])

    // Create a test with different filename casing
    await writeFile(
      join(testDir, 'DEPS.YAML'),
      `dependencies:
  bun.sh: ^1.2.20
`,
    )

    const buddy = new Buddy(config, testDir)
    const scanResult = await buddy.scanForUpdates()

    // Check that we found updates from dependency files
    const depsYamlUpdate = scanResult.updates.find(update =>
      update.file.toLowerCase().includes('deps.yaml') && update.name === 'bun.sh',
    )

    expect(depsYamlUpdate).toBeDefined()
  })

  test('should handle different dependency file names', async () => {
    // Setup mock to return updates
    mockGetOutdatedPackages.mockResolvedValueOnce([
      {
        name: 'bun.sh',
        currentVersion: '^1.2.20',
        newVersion: '1.2.21',
        updateType: 'patch' as const,
        dependencyType: 'dependencies' as const,
        file: 'deps.yaml',
        metadata: undefined,
        releaseNotesUrl: undefined,
        changelogUrl: undefined,
        homepage: undefined,
      },
    ])

    // Create alternative dependency file names
    await writeFile(
      join(testDir, 'deps.yml'),
      `dependencies:
  bun.sh: ^1.2.20
`,
    )

    await writeFile(
      join(testDir, 'dependencies.yaml'),
      `dependencies:
  bun.sh: ^1.2.20
`,
    )

    const buddy = new Buddy(config, testDir)
    const scanResult = await buddy.scanForUpdates()

    // Check that we found updates from dependency files
    const hasUpdates = scanResult.updates.some(update =>
      update.name === 'bun.sh'
      && (update.file.includes('deps.yml') || update.file.includes('dependencies.yaml')),
    )

    expect(hasUpdates).toBe(true)
  })
})
