import { describe, expect, it, spyOn } from 'bun:test'
import {
  generateComposerUpdates,
  isComposerFile,
  parseComposerFile,
  parseComposerJson,
  parseComposerLock,
} from '../src/utils/composer-parser'

describe('Composer Parser', () => {
  describe('isComposerFile', () => {
    it('should identify composer.json files correctly', () => {
      expect(isComposerFile('composer.json')).toBe(true)
      expect(isComposerFile('./composer.json')).toBe(true)
      expect(isComposerFile('path/to/composer.json')).toBe(true)
      expect(isComposerFile('/absolute/path/composer.json')).toBe(true)
    })

    it('should identify composer.lock files correctly', () => {
      expect(isComposerFile('composer.lock')).toBe(true)
      expect(isComposerFile('./composer.lock')).toBe(true)
      expect(isComposerFile('path/to/composer.lock')).toBe(true)
      expect(isComposerFile('/absolute/path/composer.lock')).toBe(true)
    })

    it('should reject non-composer files', () => {
      expect(isComposerFile('package.json')).toBe(false)
      expect(isComposerFile('composer.yml')).toBe(false)
      expect(isComposerFile('composer.yaml')).toBe(false)
      expect(isComposerFile('config.json')).toBe(false)
      expect(isComposerFile('composer.json.backup')).toBe(false)
      expect(isComposerFile('composer')).toBe(false)
    })
  })

  describe('parseComposerJson', () => {
    it('should parse valid composer.json with dependencies', async () => {
      const composerContent = JSON.stringify({
        'name': 'test/project',
        'description': 'A test project',
        'require': {
          'php': '^8.0',
          'laravel/framework': '^10.0',
          'guzzlehttp/guzzle': '^7.0',
        },
        'require-dev': {
          'phpunit/phpunit': '^10.0',
          'mockery/mockery': '^1.5',
        },
      }, null, 2)

      const result = await parseComposerJson('composer.json', composerContent)

      expect(result).not.toBeNull()
      expect(result!.path).toBe('composer.json')
      expect(result!.type).toBe('composer.json')
      expect(result!.content).toBe(composerContent)

      // Should extract only actual packages (with vendor/package format)
      const packageNames = result!.dependencies.map(dep => dep.name)
      expect(packageNames).toContain('laravel/framework')
      expect(packageNames).toContain('guzzlehttp/guzzle')
      expect(packageNames).toContain('phpunit/phpunit')
      expect(packageNames).toContain('mockery/mockery')

      // Should not include PHP itself
      expect(packageNames).not.toContain('php')

      // Check dependency types
      const requireDeps = result!.dependencies.filter(dep => dep.type === 'require')
      const requireDevDeps = result!.dependencies.filter(dep => dep.type === 'require-dev')

      expect(requireDeps).toHaveLength(2) // laravel/framework, guzzlehttp/guzzle
      expect(requireDevDeps).toHaveLength(2) // phpunit/phpunit, mockery/mockery
    })

    it('should parse composer.json with no dependencies', async () => {
      const composerContent = JSON.stringify({
        name: 'test/project',
        description: 'A test project',
      }, null, 2)

      const result = await parseComposerJson('composer.json', composerContent)

      expect(result).not.toBeNull()
      expect(result!.dependencies).toHaveLength(0)
    })

    it('should handle malformed JSON gracefully', async () => {
      const malformedContent = '{ invalid json'

      const result = await parseComposerJson('composer.json', malformedContent)

      expect(result).toBeNull()
    })

    it('should extract version constraints correctly', async () => {
      const composerContent = JSON.stringify({
        require: {
          'laravel/framework': '^10.0.0',
          'symfony/console': '~6.0',
          'doctrine/orm': '2.*',
          'monolog/monolog': '>=2.0,<3.0',
        },
      }, null, 2)

      const result = await parseComposerJson('composer.json', composerContent)

      expect(result).not.toBeNull()

      const versions = result!.dependencies.reduce((acc, dep) => {
        acc[dep.name] = dep.currentVersion
        return acc
      }, {} as Record<string, string>)

      expect(versions['laravel/framework']).toBe('^10.0.0')
      expect(versions['symfony/console']).toBe('~6.0')
      expect(versions['doctrine/orm']).toBe('2.*')
      expect(versions['monolog/monolog']).toBe('>=2.0,<3.0')
    })
  })

  describe('parseComposerLock', () => {
    it('should parse valid composer.lock with packages', async () => {
      const lockContent = JSON.stringify({
        'packages': [
          {
            name: 'laravel/framework',
            version: '10.15.0',
            type: 'library',
          },
          {
            name: 'guzzlehttp/guzzle',
            version: '7.7.0',
            type: 'library',
          },
        ],
        'packages-dev': [
          {
            name: 'phpunit/phpunit',
            version: '10.2.0',
            type: 'library',
          },
        ],
      }, null, 2)

      const result = await parseComposerLock('composer.lock', lockContent)

      expect(result).not.toBeNull()
      expect(result!.path).toBe('composer.lock')
      expect(result!.type).toBe('composer.lock')
      expect(result!.content).toBe(lockContent)

      const packageNames = result!.dependencies.map(dep => dep.name)
      expect(packageNames).toContain('laravel/framework')
      expect(packageNames).toContain('guzzlehttp/guzzle')
      expect(packageNames).toContain('phpunit/phpunit')

      // Check dependency types
      const requireDeps = result!.dependencies.filter(dep => dep.type === 'require')
      const requireDevDeps = result!.dependencies.filter(dep => dep.type === 'require-dev')

      expect(requireDeps).toHaveLength(2) // production packages
      expect(requireDevDeps).toHaveLength(1) // dev packages

      // Check versions are extracted correctly
      const laravelDep = result!.dependencies.find(dep => dep.name === 'laravel/framework')
      expect(laravelDep!.currentVersion).toBe('10.15.0')
    })

    it('should handle composer.lock with no packages', async () => {
      const lockContent = JSON.stringify({
        'packages': [],
        'packages-dev': [],
      }, null, 2)

      const result = await parseComposerLock('composer.lock', lockContent)

      expect(result).not.toBeNull()
      expect(result!.dependencies).toHaveLength(0)
    })

    it('should handle malformed lock file gracefully', async () => {
      const malformedContent = '{ invalid json'

      const result = await parseComposerLock('composer.lock', malformedContent)

      expect(result).toBeNull()
    })
  })

  describe('parseComposerFile', () => {
    it('should route to correct parser based on filename', async () => {
      const composerJsonContent = JSON.stringify({
        name: 'test/project',
        require: { 'laravel/framework': '^10.0' },
      })

      const composerLockContent = JSON.stringify({
        packages: [{ name: 'laravel/framework', version: '10.15.0' }],
      })

      const jsonResult = await parseComposerFile('composer.json', composerJsonContent)
      const lockResult = await parseComposerFile('composer.lock', composerLockContent)

      expect(jsonResult!.type).toBe('composer.json')
      expect(lockResult!.type).toBe('composer.lock')
    })

    it('should return null for non-composer files', async () => {
      const content = '{ "test": true }'
      const result = await parseComposerFile('package.json', content)

      expect(result).toBeNull()
    })
  })

  describe('generateComposerUpdates', () => {
    const mockComposerContent = JSON.stringify({
      'name': 'test/project',
      'require': {
        'laravel/framework': '^10.0.0',
        'symfony/console': '^6.0.0',
      },
      'require-dev': {
        'phpunit/phpunit': '^10.0.0',
      },
    }, null, 2)

    it('should generate updates for composer.json files', async () => {
      // Mock fs readFileSync using spyOn
      const fs = await import('node:fs')
      const readFileSpy = spyOn(fs, 'readFileSync')

      readFileSpy.mockImplementation(((filePath: any) => {
        if (String(filePath).endsWith('composer.json')) {
          return mockComposerContent
        }
        throw new Error(`File not found: ${filePath}`)
      }) as any)

      try {
        const updates = [
          { name: 'laravel/framework', newVersion: '10.16.0', file: 'composer.json' },
          { name: 'phpunit/phpunit', newVersion: '10.3.0', file: 'composer.json' },
        ]

        const result = await generateComposerUpdates(updates)

        expect(result).toHaveLength(1)
        expect(result[0].path).toBe('composer.json')
        expect(result[0].type).toBe('update')

        const updatedContent = result[0].content
        expect(updatedContent).toContain('^10.16.0') // laravel/framework updated
        expect(updatedContent).toContain('^10.3.0') // phpunit/phpunit updated
        expect(updatedContent).toContain('^6.0.0') // symfony/console unchanged
      }
      finally {
        readFileSpy.mockRestore()
      }
    })

    it('should preserve version constraints (^, ~, etc.)', async () => {
      const constraintComposerContent = JSON.stringify({
        require: {
          'laravel/framework': '~10.0.0',
          'symfony/console': '>=6.0,<7.0',
        },
      }, null, 2)

      // Mock fs readFileSync using spyOn
      const fs = await import('node:fs')
      const readFileSpy = spyOn(fs, 'readFileSync')

      readFileSpy.mockImplementation(((filePath: any) => {
        if (String(filePath).endsWith('composer.json')) {
          return constraintComposerContent
        }
        throw new Error(`File not found: ${filePath}`)
      }) as any)

      try {
        const updates = [
          { name: 'laravel/framework', newVersion: '10.16.0', file: 'composer.json' },
          { name: 'symfony/console', newVersion: '6.3.0', file: 'composer.json' },
        ]

        const result = await generateComposerUpdates(updates)

        expect(result).toHaveLength(1)
        const updatedContent = result[0].content

        expect(updatedContent).toContain('~10.16.0') // Preserves ~ constraint
        expect(updatedContent).toContain('>=6.3.0,<7.0') // Preserves complex constraint
      }
      finally {
        readFileSpy.mockRestore()
      }
    })

    it('should handle empty updates array', async () => {
      const result = await generateComposerUpdates([])
      expect(result).toHaveLength(0)
    })

    it('should handle non-composer files', async () => {
      const updates = [
        { name: 'react', newVersion: '18.0.0', file: 'package.json' },
      ]

      const result = await generateComposerUpdates(updates)
      expect(result).toHaveLength(0)
    })

    it('should handle missing packages gracefully', async () => {
      // Mock fs readFileSync using spyOn
      const fs = await import('node:fs')
      const readFileSpy = spyOn(fs, 'readFileSync')

      readFileSpy.mockImplementation(((filePath: any) => {
        if (String(filePath).endsWith('composer.json')) {
          return mockComposerContent
        }
        throw new Error(`File not found: ${filePath}`)
      }) as any)

      try {
        const updates = [
          { name: 'non-existent/package', newVersion: '1.0.0', file: 'composer.json' },
        ]

        const result = await generateComposerUpdates(updates)

        expect(result).toHaveLength(1)
        // Should still generate the file update, but warn about missing package
        const updatedContent = result[0].content
        expect(updatedContent).toContain('"laravel/framework": "^10.0.0"') // Original content preserved
        expect(updatedContent).not.toContain('non-existent/package')
      }
      finally {
        readFileSpy.mockRestore()
      }
    })
  })
})
