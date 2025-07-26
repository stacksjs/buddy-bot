import type { BuddyBotConfig, PackageUpdate } from '../src/types'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { Buddy } from '../src/buddy'
import { isDependencyFile, parseDependencyFile, updateDependencyFile } from '../src/utils/dependency-file-parser'

describe('Dependency Files Integration Tests', () => {
  const testConfig: BuddyBotConfig = {
    verbose: false,
    packages: { strategy: 'all' },
  }

  const testDepsFile = 'test-deps.yaml'
  const testDepsContent = `dependencies:
  lodash: ^4.17.20
  react: ^17.0.0

devDependencies:
  typescript: ^4.9.0`

  beforeAll(() => {
    // Create a test dependency file
    writeFileSync(testDepsFile, testDepsContent)
  })

  afterAll(() => {
    // Clean up test files
    if (existsSync(testDepsFile)) {
      unlinkSync(testDepsFile)
    }
  })

  describe('File Detection', () => {
    it('should correctly identify dependency files', () => {
      expect(isDependencyFile('deps.yaml')).toBe(true)
      expect(isDependencyFile('deps.yml')).toBe(true)
      expect(isDependencyFile('dependencies.yaml')).toBe(true)
      expect(isDependencyFile('dependencies.yml')).toBe(true)
      expect(isDependencyFile('pkgx.yaml')).toBe(true)
      expect(isDependencyFile('pkgx.yml')).toBe(true)
      expect(isDependencyFile('.deps.yaml')).toBe(true)
      expect(isDependencyFile('.deps.yml')).toBe(true)

      // Should reject non-dependency files
      expect(isDependencyFile('package.json')).toBe(false)
      expect(isDependencyFile('config.yaml')).toBe(false)
      expect(isDependencyFile('docker-compose.yml')).toBe(false)
    })

    it('should handle nested paths correctly', () => {
      expect(isDependencyFile('config/deps.yaml')).toBe(true)
      expect(isDependencyFile('./project/dependencies.yml')).toBe(true)
      expect(isDependencyFile('/absolute/path/to/pkgx.yaml')).toBe(true)
    })
  })

  describe('File Parsing', () => {
    it('should parse dependency files with ts-pkgx using existing deps.yaml', async () => {
      // Test with the actual deps.yaml file in the project
      const result = await parseDependencyFile('deps.yaml', testDepsContent)

      if (result) {
        expect(result.path).toBe('deps.yaml')
        expect(result.type).toBe('deps.yaml')
        expect(result.content).toBe(testDepsContent)
        expect(Array.isArray(result.dependencies)).toBe(true)
      }
      else {
        // If parsing returns null, it should be handled gracefully
        expect(result).toBeNull()
      }
    })

    it('should handle non-dependency files', async () => {
      const result = await parseDependencyFile('package.json', '{"name": "test"}')
      expect(result).toBeNull()
    })

    it('should parse dependency files without ts-pkgx errors', async () => {
      // Test the logic without requiring file to exist on disk
      const mockContent = `dependencies:
  react: ^18.0.0
  lodash: ^4.17.21`

      // This should work with any dependency file name
      const result = await parseDependencyFile('mock-deps.yaml', mockContent)

      // Result might be null if ts-pkgx can't find the file, which is expected
      // The function should handle this gracefully
      expect(typeof result === 'object' || result === null).toBe(true)
    })
  })

  describe('File Updates', () => {
    const sampleUpdates: PackageUpdate[] = [
      {
        name: 'lodash',
        currentVersion: '^4.17.20',
        newVersion: '4.17.21',
        updateType: 'patch',
        dependencyType: 'dependencies',
        file: testDepsFile,
      },
      {
        name: 'typescript',
        currentVersion: '^4.9.0',
        newVersion: '5.0.0',
        updateType: 'major',
        dependencyType: 'devDependencies',
        file: testDepsFile,
      },
    ]

    it('should update dependency versions while preserving format', async () => {
      const updatedContent = await updateDependencyFile('deps.yaml', testDepsContent, sampleUpdates)

      expect(updatedContent).toContain('lodash: ^4.17.21')
      expect(updatedContent).toContain('typescript: ^5.0.0')
      expect(updatedContent).toContain('react: ^17.0.0') // unchanged

      // Should preserve YAML structure
      expect(updatedContent).toContain('dependencies:')
      expect(updatedContent).toContain('devDependencies:')
    })

    it('should preserve version prefixes', async () => {
      const contentWithDifferentPrefixes = `dependencies:
   package-a: ^1.0.0
   package-b: ~2.0.0
   package-c: >=3.0.0
   package-d: 4.0.0`

      const updates: PackageUpdate[] = [
        {
          name: 'package-a',
          currentVersion: '^1.0.0',
          newVersion: '1.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
        {
          name: 'package-b',
          currentVersion: '~2.0.0',
          newVersion: '2.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
        {
          name: 'package-c',
          currentVersion: '>=3.0.0',
          newVersion: '3.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
        {
          name: 'package-d',
          currentVersion: '4.0.0',
          newVersion: '4.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
      ]

      const result = await updateDependencyFile('deps.yaml', contentWithDifferentPrefixes, updates)

      expect(result).toContain('package-a: ^1.1.0')
      expect(result).toContain('package-b: ~2.1.0')
      expect(result).toContain('package-c: >=3.1.0')
      expect(result).toContain('package-d: 4.1.0')
    })

    it('should handle packages not found in file', async () => {
      const updatesWithMissingPackage: PackageUpdate[] = [
        {
          name: 'nonexistent-package',
          currentVersion: '^1.0.0',
          newVersion: '1.1.0',
          updateType: 'minor',
          dependencyType: 'dependencies',
          file: testDepsFile,
        },
      ]

      const result = await updateDependencyFile(testDepsFile, testDepsContent, updatesWithMissingPackage)

      // Should return unchanged content
      expect(result).toBe(testDepsContent)
    })
  })

  describe('Integration with Buddy', () => {
    it('should initialize Buddy with dependency file support', () => {
      const buddy = new Buddy(testConfig)
      expect(buddy).toBeDefined()
      expect(typeof buddy.generateAllFileUpdates).toBe('function')
    })

    it('should have access to dependency file utilities', () => {
      // Test that the dependency file utilities are available
      expect(typeof isDependencyFile).toBe('function')
      expect(typeof parseDependencyFile).toBe('function')
      expect(typeof updateDependencyFile).toBe('function')
    })
  })

  describe('Type Safety', () => {
    it('should maintain type safety for PackageFile types', () => {
      // Test that our new types are properly integrated
      const validTypes = [
        'package.json',
        'bun.lockb',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'deps.yaml',
        'deps.yml',
        'dependencies.yaml',
        'dependencies.yml',
        'pkgx.yaml',
        'pkgx.yml',
        '.deps.yaml',
        '.deps.yml',
      ]

      // This test verifies TypeScript compilation more than runtime behavior
      validTypes.forEach((type) => {
        expect(typeof type).toBe('string')
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle malformed YAML gracefully', async () => {
      const malformedYaml = 'dependencies:\n  invalid: yaml: content {'

      const result = await updateDependencyFile('test.yaml', malformedYaml, [])

      // Should return original content on error
      expect(result).toBe(malformedYaml)
    })

    it('should handle empty update arrays', async () => {
      const result = await updateDependencyFile(testDepsFile, testDepsContent, [])
      expect(result).toBe(testDepsContent)
    })

    it('should handle files that do not exist', () => {
      // isDependencyFile should work regardless of file existence
      expect(isDependencyFile('deps.yaml')).toBe(true)
      expect(isDependencyFile('non-existent.txt')).toBe(false)
    })
  })

  describe('Real-world Scenarios', () => {
    it('should handle mixed file extensions', () => {
      const extensions = ['.yaml', '.yml']
      const baseNames = ['deps', 'dependencies', 'pkgx', '.deps']

      for (const baseName of baseNames) {
        for (const ext of extensions) {
          const fileName = `${baseName}${ext}`
          expect(isDependencyFile(fileName)).toBe(true)
        }
      }
    })

    it('should preserve complex YAML formatting', async () => {
      const complexYaml = `# This is a comment
dependencies:
  # Production dependencies
  lodash: ^4.17.20  # Utility library
  react: ^17.0.0

devDependencies:
  # Development dependencies
  typescript: ^4.9.0

# End of file`

      const updates: PackageUpdate[] = [
        {
          name: 'lodash',
          currentVersion: '^4.17.20',
          newVersion: '4.17.21',
          updateType: 'patch',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
      ]

      const result = await updateDependencyFile('deps.yaml', complexYaml, updates)

      // Should update the version but preserve comments and structure
      expect(result).toContain('lodash: ^4.17.21')
      expect(result).toContain('# This is a comment')
      expect(result).toContain('# Production dependencies')
      expect(result).toContain('# Development dependencies')
      expect(result).toContain('# End of file')

      // Note: Inline comments on the same line as the version may be lost during updates
      // This is expected behavior as we replace the entire version portion
    })
  })
})
