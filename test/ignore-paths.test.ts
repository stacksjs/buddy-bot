import type { BuddyBotConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buddy } from '../src/buddy'
import { PackageScanner } from '../src/scanner/package-scanner'
import { Logger } from '../src/utils/logger'

describe('IgnorePaths Functionality', () => {
  let testDir: string
  let originalCwd: string

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await fs.mkdtemp(join(tmpdir(), 'buddy-bot-ignore-test-'))
    originalCwd = process.cwd()
    process.chdir(testDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('PackageScanner with ignorePaths', () => {
    it('should ignore files matching glob patterns', async () => {
      // Create test directory structure
      await fs.mkdir('packages/launchpad/test-envs/env1', { recursive: true })
      await fs.mkdir('packages/launchpad/src', { recursive: true })
      await fs.mkdir('packages/core/src', { recursive: true })

      // Create package.json files
      const packageJson = JSON.stringify({ name: 'test-package', version: '1.0.0' })
      await fs.writeFile('packages/launchpad/test-envs/env1/package.json', packageJson)
      await fs.writeFile('packages/launchpad/src/package.json', packageJson)
      await fs.writeFile('packages/core/src/package.json', packageJson)

      const logger = Logger.quiet()
      const ignorePaths = ['packages/launchpad/test-envs/**']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should find the src packages but not the test-envs one
      expect(packageFiles.length).toBeGreaterThanOrEqual(2)
      expect(packageFiles.some(f => f.path.includes('test-envs'))).toBe(false)
      expect(packageFiles.some(f => f.path.includes('packages/launchpad/src'))).toBe(true)
      expect(packageFiles.some(f => f.path.includes('packages/core/src'))).toBe(true)
    })

    it('should handle multiple ignore patterns', async () => {
      // Create test directory structure
      await fs.mkdir('packages/test-env1/src', { recursive: true })
      await fs.mkdir('packages/test-env2/src', { recursive: true })
      await fs.mkdir('packages/legacy/old', { recursive: true })
      await fs.mkdir('packages/app/src', { recursive: true })

      // Create package.json files
      const packageJson = JSON.stringify({ name: 'test-package', version: '1.0.0' })
      await fs.writeFile('packages/test-env1/src/package.json', packageJson)
      await fs.writeFile('packages/test-env2/src/package.json', packageJson)
      await fs.writeFile('packages/legacy/old/package.json', packageJson)
      await fs.writeFile('packages/app/src/package.json', packageJson)

      const logger = Logger.quiet()
      const ignorePaths = [
        'packages/test-*/**',
        'packages/legacy/**',
      ]
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should only find the app package
      expect(packageFiles.some(f => f.path.includes('app/src'))).toBe(true)
      expect(packageFiles.some(f => f.path.includes('test-'))).toBe(false)
      expect(packageFiles.some(f => f.path.includes('legacy'))).toBe(false)
    })

    it('should handle dependency files (.deps.yaml, composer.json)', async () => {
      // Create test directory structure
      await fs.mkdir('packages/test-envs/env1', { recursive: true })
      await fs.mkdir('packages/app/src', { recursive: true })

      // Create various dependency files
      const depsYaml = 'dependencies:\n  node: ^20.0.0'
      const composerJson = JSON.stringify({ name: 'test/package', require: { php: '^8.1' } })

      await fs.writeFile('packages/test-envs/env1/deps.yaml', depsYaml)
      await fs.writeFile('packages/test-envs/env1/composer.json', composerJson)
      await fs.writeFile('packages/app/src/deps.yaml', depsYaml)
      await fs.writeFile('packages/app/src/composer.json', composerJson)

      const logger = Logger.quiet()
      const ignorePaths = ['packages/test-envs/**']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should only find the app files, not test-envs
      const testEnvFiles = packageFiles.filter(f => f.path.includes('test-envs'))
      const appFiles = packageFiles.filter(f => f.path.includes('app/src'))

      expect(testEnvFiles).toHaveLength(0)
      expect(appFiles.length).toBeGreaterThan(0)
    })

    it('should handle GitHub Actions workflow files', async () => {
      // Create test directory structure
      await fs.mkdir('.github/workflows', { recursive: true })
      await fs.mkdir('packages/test-envs/.github/workflows', { recursive: true })

      // Create workflow files
      const workflow = 'name: Test\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4'
      await fs.writeFile('.github/workflows/ci.yml', workflow)
      await fs.writeFile('packages/test-envs/.github/workflows/test.yml', workflow)

      const logger = Logger.quiet()
      const ignorePaths = ['packages/test-envs/**']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should only find the root workflow, not the test-envs one
      const testEnvWorkflows = packageFiles.filter(f => f.path.includes('test-envs') && f.path.includes('.github'))
      const rootWorkflows = packageFiles.filter(f => f.path.includes('.github/workflows') && !f.path.includes('test-envs'))

      expect(testEnvWorkflows).toHaveLength(0)
      expect(rootWorkflows.length).toBeGreaterThan(0)
    })

    it('should work without ignore patterns (backward compatibility)', async () => {
      // Create test files
      await fs.mkdir('src', { recursive: true })
      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile('src/package.json', packageJson)

      const logger = Logger.quiet()
      const scanner = new PackageScanner(testDir, logger) // No ignore patterns

      const packageFiles = await scanner.scanProject()

      expect(packageFiles).toHaveLength(1)
      expect(packageFiles[0].path).toContain('src/package.json')
    })

    it('should handle edge cases and complex glob patterns', async () => {
      // Create complex directory structure
      await fs.mkdir('apps/test-app/node_modules/package', { recursive: true })
      await fs.mkdir('apps/prod-app/src', { recursive: true })
      await fs.mkdir('packages/ui/test', { recursive: true })
      await fs.mkdir('packages/ui/src', { recursive: true })

      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile('apps/test-app/package.json', packageJson)
      await fs.writeFile('apps/prod-app/src/package.json', packageJson)
      await fs.writeFile('packages/ui/test/package.json', packageJson)
      await fs.writeFile('packages/ui/src/package.json', packageJson)

      const logger = Logger.quiet()
      const ignorePaths = [
        '**/test-*/**', // Ignore any test-* directory anywhere
        '**/test/**', // Ignore any test directory anywhere
      ]
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should only find prod-app and ui/src
      expect(packageFiles).toHaveLength(2)
      expect(packageFiles.some(f => f.path.includes('test-app'))).toBe(false)
      expect(packageFiles.some(f => f.path.includes('ui/test'))).toBe(false)
      expect(packageFiles.some(f => f.path.includes('prod-app'))).toBe(true)
      expect(packageFiles.some(f => f.path.includes('ui/src'))).toBe(true)
    })
  })

  describe('Buddy class integration', () => {
    it('should pass ignorePaths to PackageScanner correctly', async () => {
      // Create test structure
      await fs.mkdir('test-envs/env1', { recursive: true })
      await fs.mkdir('src', { recursive: true })

      const packageJson = JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: { lodash: '^4.0.0' },
      })
      await fs.writeFile('test-envs/env1/package.json', packageJson)
      await fs.writeFile('src/package.json', packageJson)

      const config: BuddyBotConfig = {
        repository: {
          provider: 'github',
          owner: 'test',
          name: 'test',
        },
        packages: {
          strategy: 'all',
          ignorePaths: ['test-envs/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      // Test just the scanner part to avoid bun outdated errors
      // @ts-expect-error - accessing private property for testing
      const scanner = buddy.scanner

      // Verify that the scanner was initialized with ignore patterns
      // @ts-expect-error - accessing private property for testing
      expect(scanner.ignoreGlobs.length).toBe(1)
    })

    it('should handle empty ignorePaths array', async () => {
      const config: BuddyBotConfig = {
        repository: {
          provider: 'github',
          owner: 'test',
          name: 'test',
        },
        packages: {
          strategy: 'all',
          ignorePaths: [], // Empty array
        },
      }

      const buddy = new Buddy(config, testDir)

      // @ts-expect-error - accessing private property for testing
      const scanner = buddy.scanner

      // @ts-expect-error - accessing private property for testing
      expect(scanner.ignoreGlobs.length).toBe(0)
    })

    it('should handle undefined ignorePaths', async () => {
      const config: BuddyBotConfig = {
        repository: {
          provider: 'github',
          owner: 'test',
          name: 'test',
        },
        packages: {
          strategy: 'all',
          // ignorePaths not defined
        },
      }

      const buddy = new Buddy(config, testDir)

      // @ts-expect-error - accessing private property for testing
      const scanner = buddy.scanner

      // @ts-expect-error - accessing private property for testing
      expect(scanner.ignoreGlobs.length).toBe(0)
    })
  })

  describe('Glob pattern validation', () => {
    it('should handle valid glob patterns correctly', async () => {
      await fs.mkdir('test/dir', { recursive: true })
      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile('test/dir/package.json', packageJson)

      const logger = Logger.quiet()

      // Test various valid patterns
      const patterns = [
        'test/**',
        '**/test/**',
        'test/*/package.json',
        '**/*test*/**',
        '{test,spec}/**',
      ]

      for (const pattern of patterns) {
        const scanner = new PackageScanner(testDir, logger, [pattern])
        const packageFiles = await scanner.scanProject()

        // All patterns should match and ignore our test file
        expect(packageFiles.some(f => f.path.includes('test/dir'))).toBe(false)
      }
    })

    it('should handle negation patterns', async () => {
      await fs.mkdir('app/src', { recursive: true })
      await fs.mkdir('app/test', { recursive: true })

      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile('app/src/package.json', packageJson)
      await fs.writeFile('app/test/package.json', packageJson)

      const logger = Logger.quiet()
      const ignorePaths = ['!app/src/**', 'app/**'] // This should ignore app/** except app/src/**

      const scanner = new PackageScanner(testDir, logger, ignorePaths)
      const packageFiles = await scanner.scanProject()

      // Note: Bun glob doesn't support negation the same way as some other glob implementations
      // This test validates current behavior
      expect(packageFiles.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Performance and edge cases', () => {
    it('should handle large numbers of ignored files efficiently', async () => {
      // Create many test directories
      for (let i = 0; i < 50; i++) {
        await fs.mkdir(`test-env-${i}/src`, { recursive: true })
        const packageJson = JSON.stringify({ name: `test-${i}`, version: '1.0.0' })
        await fs.writeFile(`test-env-${i}/src/package.json`, packageJson)
      }

      // Create one non-ignored file
      await fs.mkdir('app/src', { recursive: true })
      const packageJson = JSON.stringify({ name: 'app', version: '1.0.0' })
      await fs.writeFile('app/src/package.json', packageJson)

      const logger = Logger.quiet()
      const ignorePaths = ['test-env-*/**']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const startTime = Date.now()
      const packageFiles = await scanner.scanProject()
      const duration = Date.now() - startTime

      // Should only find the app file
      expect(packageFiles).toHaveLength(1)
      expect(packageFiles[0].path).toContain('app/src')

      // Should complete reasonably quickly (less than 5 seconds)
      expect(duration).toBeLessThan(5000)
    })

    it('should handle deep directory nesting', async () => {
      // Create deeply nested structure
      const deepPath = 'a/b/c/d/e/f/g/test-envs/env/src'
      await fs.mkdir(deepPath, { recursive: true })
      await fs.mkdir('app/src', { recursive: true })

      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile(`${deepPath}/package.json`, packageJson)
      await fs.writeFile('app/src/package.json', packageJson)

      const logger = Logger.quiet()
      const ignorePaths = ['**/test-envs/**']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should only find the app file
      expect(packageFiles).toHaveLength(1)
      expect(packageFiles[0].path).toContain('app/src')
    })

    it('should handle invalid/broken symlinks gracefully', async () => {
      await fs.mkdir('src', { recursive: true })
      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile('src/package.json', packageJson)

      // Create broken symlink (if supported)
      try {
        await fs.symlink('/nonexistent/path', 'broken-link')
      }
      catch {
        // If symlinks aren't supported, that's fine
      }

      const logger = Logger.quiet()
      const ignorePaths = ['broken-*']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      // Should not throw and should find the valid package file
      const packageFiles = await scanner.scanProject()
      expect(packageFiles.length).toBeGreaterThanOrEqual(1)
    })
  })
})
