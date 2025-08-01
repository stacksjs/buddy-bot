import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import * as nodeFs from 'node:fs'
import { Buddy } from '../src/buddy'

describe('Composer Individual PR Simulation', () => {
  let buddy: Buddy
  let readFileSpy: any
  let existsSyncSpy: any
  let writeFileSpy: any
  let mkdirSyncSpy: any

  const mockComposerJson = {
    'require': {
      'php': '^8.1',
      'laravel/framework': '^10.0',
      'guzzlehttp/guzzle': '^7.0',
      'symfony/console': '^6.0',
      'monolog/monolog': '^3.0',
      'doctrine/dbal': '^3.0',
    },
    'require-dev': {
      'phpunit/phpunit': '^10.0',
    },
  }

  const mockComposerJsonString = JSON.stringify(mockComposerJson, null, 2)

  beforeEach(() => {
    // Force clean up any existing mocks before setting up new ones
    try {
      if ((fs.readFileSync as any).mockRestore) {
        (fs.readFileSync as any).mockRestore()
      }
      if ((fs.existsSync as any).mockRestore) {
        (fs.existsSync as any).mockRestore()
      }
      if ((fs.writeFileSync as any).mockRestore) {
        (fs.writeFileSync as any).mockRestore()
      }
      if ((fs.mkdirSync as any).mockRestore) {
        (fs.mkdirSync as any).mockRestore()
      }
      if ((nodeFs.readFileSync as any).mockRestore) {
        (nodeFs.readFileSync as any).mockRestore()
      }
    }
    catch {
      // Ignore errors if mocks don't exist
    }

    const mockConfig = {
      repository: {
        provider: 'github' as const,
        owner: 'test-owner',
        name: 'test-repo',
        baseBranch: 'main',
      },
      packages: {
        strategy: 'all' as const,
        ignore: [],
        includePrerelease: false,
        excludeMajor: false,
      },
    }
    buddy = new Buddy(mockConfig)

    // Mock filesystem - ensure we always return the correct composer.json
    // Mock both default import and named import to cover all cases
    readFileSpy = spyOn(fs, 'readFileSync')
    readFileSpy.mockImplementation((filePath: any, _options?: any): any => {
      // Always return our specific composer.json content
      if (typeof filePath === 'string' && (filePath === 'composer.json' || filePath.endsWith('composer.json'))) {
        return mockComposerJsonString
      }
      return '{}'
    })

    // Also mock the named import (nodeFs.readFileSync) which is used by composer-parser
    const nodeReadFileSpy = spyOn(nodeFs, 'readFileSync')
    nodeReadFileSpy.mockImplementation((filePath: any, _options?: any): any => {
      // Always return our specific composer.json content
      if (typeof filePath === 'string' && (filePath === 'composer.json' || filePath.endsWith('composer.json'))) {
        return mockComposerJsonString
      }
      return '{}'
    })

    // Also verify our mock content is correct
    const testContent = JSON.parse(mockComposerJsonString)
    if (!testContent.require || !testContent.require['symfony/console']) {
      throw new Error('Mock setup error: composer.json should contain symfony/console')
    }
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true)
    writeFileSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    mkdirSyncSpy = spyOn(fs, 'mkdirSync').mockImplementation(() => {})
  })

  afterEach(() => {
    // Clean up filesystem mocks to prevent contamination of other tests
    if (readFileSpy && typeof readFileSpy.mockRestore === 'function') {
      readFileSpy.mockRestore()
    }
    if (existsSyncSpy && typeof existsSyncSpy.mockRestore === 'function') {
      existsSyncSpy.mockRestore()
    }
    if (writeFileSpy && typeof writeFileSpy.mockRestore === 'function') {
      writeFileSpy.mockRestore()
    }
    if (mkdirSyncSpy && typeof mkdirSyncSpy.mockRestore === 'function') {
      mkdirSyncSpy.mockRestore()
    }
  })

  it('should generate correct file changes for individual symfony/console major update', async () => {
    // Simulate individual major update group for symfony/console only
    const symfonyGroup = [
      {
        name: 'symfony/console',
        currentVersion: 'v6.4.23',
        newVersion: 'v7.3.1',
        updateType: 'major' as const,
        dependencyType: 'require' as const,
        file: 'composer.json',
      },
    ]

    const fileUpdates = await buddy.generateAllFileUpdates(symfonyGroup)

    // Should have exactly 1 file update for composer.json
    const composerUpdates = fileUpdates.filter(f => f.path === 'composer.json')
    expect(composerUpdates).toHaveLength(1)

    const updatedContent = composerUpdates[0].content
    const updatedJson = JSON.parse(updatedContent)

    // Should update ONLY symfony/console
    expect(updatedJson.require['symfony/console']).toBe('^v7.3.1')

    // Should NOT update other packages
    expect(updatedJson.require['laravel/framework']).toBe('^10.0')
    expect(updatedJson.require['doctrine/dbal']).toBe('^3.0')
    expect(updatedJson.require['guzzlehttp/guzzle']).toBe('^7.0')
    expect(updatedJson.require['monolog/monolog']).toBe('^3.0')
  })

  it('should generate correct file changes for individual doctrine/dbal major update', async () => {
    // Simulate individual major update group for doctrine/dbal only
    const doctrineGroup = [
      {
        name: 'doctrine/dbal',
        currentVersion: '3.10.0',
        newVersion: '4.3.1',
        updateType: 'major' as const,
        dependencyType: 'require' as const,
        file: 'composer.json',
      },
    ]

    const fileUpdates = await buddy.generateAllFileUpdates(doctrineGroup)

    const composerUpdates = fileUpdates.filter(f => f.path === 'composer.json')
    expect(composerUpdates).toHaveLength(1)

    const updatedContent = composerUpdates[0].content
    const updatedJson = JSON.parse(updatedContent)

    // Should update ONLY doctrine/dbal
    expect(updatedJson.require['doctrine/dbal']).toBe('^4.3.1')

    // Should NOT update other packages
    expect(updatedJson.require['symfony/console']).toBe('^6.0')
    expect(updatedJson.require['laravel/framework']).toBe('^10.0')
    expect(updatedJson.require['guzzlehttp/guzzle']).toBe('^7.0')
  })

  it('should generate correct file changes for individual laravel/framework major update', async () => {
    // Simulate individual major update group for laravel/framework only
    const laravelGroup = [
      {
        name: 'laravel/framework',
        currentVersion: 'v10.48.29',
        newVersion: 'v12.21.0',
        updateType: 'major' as const,
        dependencyType: 'require' as const,
        file: 'composer.json',
      },
    ]

    const fileUpdates = await buddy.generateAllFileUpdates(laravelGroup)

    const composerUpdates = fileUpdates.filter(f => f.path === 'composer.json')
    expect(composerUpdates).toHaveLength(1)

    const updatedContent = composerUpdates[0].content
    const updatedJson = JSON.parse(updatedContent)

    // Should update ONLY laravel/framework
    expect(updatedJson.require['laravel/framework']).toBe('^v12.21.0')

    // Should NOT update other packages
    expect(updatedJson.require['symfony/console']).toBe('^6.0')
    expect(updatedJson.require['doctrine/dbal']).toBe('^3.0')
    expect(updatedJson.require['guzzlehttp/guzzle']).toBe('^7.0')
  })

  it('should handle sequential individual updates without interference', async () => {
    // Test that creating multiple individual updates in sequence doesn't interfere

    // First: symfony/console update
    const symfonyGroup = [{
      name: 'symfony/console',
      currentVersion: 'v6.4.23',
      newVersion: 'v7.3.1',
      updateType: 'major' as const,
      dependencyType: 'require' as const,
      file: 'composer.json',
    }]

    const symfonyFiles = await buddy.generateAllFileUpdates(symfonyGroup)
    const symfonyComposer = JSON.parse(symfonyFiles.find(f => f.path === 'composer.json')!.content)

    // Should only update symfony/console
    expect(symfonyComposer.require['symfony/console']).toBe('^v7.3.1')
    expect(symfonyComposer.require['doctrine/dbal']).toBe('^3.0') // unchanged

    // Second: doctrine/dbal update (simulating a fresh state)
    const doctrineGroup = [{
      name: 'doctrine/dbal',
      currentVersion: '3.10.0',
      newVersion: '4.3.1',
      updateType: 'major' as const,
      dependencyType: 'require' as const,
      file: 'composer.json',
    }]

    const doctrineFiles = await buddy.generateAllFileUpdates(doctrineGroup)
    const doctrineComposer = JSON.parse(doctrineFiles.find(f => f.path === 'composer.json')!.content)

    // Should only update doctrine/dbal
    expect(doctrineComposer.require['doctrine/dbal']).toBe('^4.3.1')
    expect(doctrineComposer.require['symfony/console']).toBe('^6.0') // unchanged from original
  })
})
