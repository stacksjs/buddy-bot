import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { RegistryClient } from '../src/registry/registry-client'
import fs from 'node:fs'

describe('Composer Constraint Filtering', () => {
  let registryClient: RegistryClient
  
  beforeEach(() => {
    const mockConfig = {
      packages: {
        strategy: 'all' as const,
        ignore: [],
        includePrerelease: false,
        excludeMajor: false
      }
    }
    const mockLogger = {
      info: (...args: any[]) => console.log('[INFO]', ...args),
      warn: (...args: any[]) => console.log('[WARN]', ...args), 
      error: (...args: any[]) => console.log('[ERROR]', ...args),
      success: (...args: any[]) => console.log('[SUCCESS]', ...args),
      debug: (...args: any[]) => console.log('[DEBUG]', ...args)
    }
    registryClient = new RegistryClient(mockConfig, '.', mockLogger as any)
  })

  it('should include minor/patch updates within caret constraints', async () => {
    // Mock composer.json with caret constraints (real constraints from user's repo)
    const mockComposerJson = {
      "require": {
        "laravel/framework": "^10.0",
        "symfony/console": "^6.0", 
        "monolog/monolog": "^3.0",
        "doctrine/dbal": "^3.0",
        "guzzlehttp/guzzle": "^7.0"
      },
      "require-dev": {
        "phpunit/phpunit": "^10.0",
        "mockery/mockery": "^1.5",
        "fakerphp/faker": "^1.20"
      }
    }

    // Mock composer outdated output - this is what the real command returns
    const mockComposerOutdated = {
      "installed": [
        // These should be INCLUDED (minor/patch updates within constraints)
        {
          "name": "laravel/framework",
          "version": "10.0.0", 
          "latest": "10.48.29"  // Minor update within ^10.0
        },
        {
          "name": "symfony/console",
          "version": "6.0.0",
          "latest": "6.4.23"    // Minor update within ^6.0
        },
        {
          "name": "monolog/monolog",
          "version": "3.0.0",
          "latest": "3.9.0"     // Minor update within ^3.0
        },
        {
          "name": "doctrine/dbal",
          "version": "3.0.0",
          "latest": "3.10.0"    // Minor update within ^3.0
        },
        {
          "name": "guzzlehttp/guzzle",
          "version": "7.0.0",
          "latest": "7.9.3"     // Minor update within ^7.0
        },
        {
          "name": "phpunit/phpunit",
          "version": "10.0.0",
          "latest": "10.5.48"   // Minor update within ^10.0
        },
        {
          "name": "mockery/mockery",
          "version": "1.5.0",
          "latest": "1.6.12"    // Minor update within ^1.5
        },
        {
          "name": "fakerphp/faker",
          "version": "1.20.0",
          "latest": "1.24.1"    // Minor update within ^1.20
        },
        // These should be EXCLUDED (major updates outside constraints)
        {
          "name": "symfony/console",
          "version": "6.4.23",
          "latest": "7.3.1"     // Major update outside ^6.0
        },
        {
          "name": "laravel/framework", 
          "version": "10.48.29",
          "latest": "12.21.0"   // Major update outside ^10.0
        }
      ]
    }

    // Mock file system and commands
    spyOn(fs, 'existsSync').mockReturnValue(true)
    spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockComposerJson))
    
    spyOn(registryClient as any, 'runCommand').mockImplementation((command: string, args: string[]) => {
      if (command === 'composer' && args[0] === '--version') {
        return Promise.resolve('Composer version 2.7.1')
      }
      if (command === 'composer' && args.includes('outdated')) {
        return Promise.resolve(JSON.stringify(mockComposerOutdated))
      }
      return Promise.reject(new Error('Unexpected command'))
    })

    const updates = await registryClient.getComposerOutdatedPackages()
    
    // Should find 8 minor/patch updates, exclude 2 major updates
    expect(updates).toHaveLength(8)
    
    // Verify included packages
    const packageNames = updates.map(u => u.name)
    expect(packageNames).toContain('laravel/framework')
    expect(packageNames).toContain('symfony/console')
    expect(packageNames).toContain('monolog/monolog')
    expect(packageNames).toContain('doctrine/dbal')
    expect(packageNames).toContain('guzzlehttp/guzzle')
    expect(packageNames).toContain('phpunit/phpunit')
    expect(packageNames).toContain('mockery/mockery')
    expect(packageNames).toContain('fakerphp/faker')
    
    // Verify versions are the minor updates, not major
    const laravelUpdate = updates.find(u => u.name === 'laravel/framework')!
    expect(laravelUpdate.newVersion).toBe('10.48.29')  // Not 12.21.0
    
    const symfonyUpdate = updates.find(u => u.name === 'symfony/console')!
    expect(symfonyUpdate.newVersion).toBe('6.4.23')    // Not 7.3.1
    
    // Verify all are minor/patch updates
    updates.forEach(update => {
      expect(['minor', 'patch']).toContain(update.updateType)
    })
  })

  it('should allow major updates when no constraints restrict them', async () => {
    // Mock composer.json with loose constraints or no constraints
    const mockComposerJson = {
      "require": {
        "some/package": ">=1.0",  // Allows major updates
        "other/package": "*"      // Allows any version
      }
    }

    const mockComposerOutdated = {
      "installed": [
        {
          "name": "some/package",
          "version": "1.0.0",
          "latest": "2.0.0"   // Major update allowed by >=1.0
        },
        {
          "name": "other/package", 
          "version": "1.0.0",
          "latest": "3.0.0"   // Major update allowed by *
        }
      ]
    }

    spyOn(fs, 'existsSync').mockReturnValue(true)
    spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockComposerJson))
    
    spyOn(registryClient as any, 'runCommand').mockImplementation((command: string, args: string[]) => {
      if (command === 'composer' && args[0] === '--version') {
        return Promise.resolve('Composer version 2.7.1')
      }
      if (command === 'composer' && args.includes('outdated')) {
        return Promise.resolve(JSON.stringify(mockComposerOutdated))
      }
      return Promise.reject(new Error('Unexpected command'))
    })

    const updates = await registryClient.getComposerOutdatedPackages()
    
    // Should include both major updates
    expect(updates).toHaveLength(2)
    
    updates.forEach(update => {
      expect(update.updateType).toBe('major')
    })
  })

  it('should handle tilde constraints correctly', async () => {
    const mockComposerJson = {
      "require": {
        "patch-only": "~1.2.3",    // Only allows 1.2.x patches
        "minor-allowed": "~1.2"     // Allows 1.x.x minor/patch
      }
    }

    const mockComposerOutdated = {
      "installed": [
        // Should be included
        {
          "name": "patch-only",
          "version": "1.2.3",
          "latest": "1.2.5"     // Patch within ~1.2.3
        },
        {
          "name": "minor-allowed",
          "version": "1.2.0",
          "latest": "1.5.0"     // Minor within ~1.2
        },
        // Should be excluded  
        {
          "name": "patch-only",
          "version": "1.2.5",
          "latest": "1.3.0"     // Minor outside ~1.2.3
        },
        {
          "name": "minor-allowed",
          "version": "1.5.0", 
          "latest": "2.0.0"     // Major outside ~1.2
        }
      ]
    }

    spyOn(fs, 'existsSync').mockReturnValue(true)
    spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockComposerJson))
    
    spyOn(registryClient as any, 'runCommand').mockImplementation((command: string, args: string[]) => {
      if (command === 'composer' && args[0] === '--version') {
        return Promise.resolve('Composer version 2.7.1')
      }
      if (command === 'composer' && args.includes('outdated')) {
        return Promise.resolve(JSON.stringify(mockComposerOutdated))
      }
      return Promise.reject(new Error('Unexpected command'))
    })

    const updates = await registryClient.getComposerOutdatedPackages()
    
    // Should find 2 allowed updates
    expect(updates).toHaveLength(2)
    
    const patchUpdate = updates.find(u => u.name === 'patch-only')!
    expect(patchUpdate.newVersion).toBe('1.2.5')
    
    const minorUpdate = updates.find(u => u.name === 'minor-allowed')!
    expect(minorUpdate.newVersion).toBe('1.5.0')
  })
}) 