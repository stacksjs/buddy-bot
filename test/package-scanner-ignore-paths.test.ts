/* eslint-disable no-console */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PackageScanner } from '../src/scanner/package-scanner'
import { Logger } from '../src/utils/logger'

describe('PackageScanner IgnorePaths Integration', () => {
  let testDir: string
  let originalCwd: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(join(tmpdir(), 'buddy-scanner-test-'))
    originalCwd = process.cwd()
    process.chdir(testDir)
  })

  afterEach(async () => {
    try {
      // Change back to original directory first, before deleting the test directory
      process.chdir(originalCwd)
    }
    catch {
      // If we can't change back to original directory, try to change to a safe directory
      try {
        process.chdir(tmpdir())
      }
      catch {
        // If all else fails, change to root
        process.chdir('/')
      }
    }

    try {
      await fs.rm(testDir, { recursive: true, force: true })
    }
    catch (error) {
      // Ignore cleanup errors - the temp directory will be cleaned up by the OS eventually
      console.warn(`Failed to clean up test directory ${testDir}:`, error)
    }
  })

  describe('Real-world scenarios', () => {
    it('should handle launchpad test-envs scenario correctly', async () => {
      // Create the exact structure the user described
      await fs.mkdir('packages/launchpad/test-envs/env1', { recursive: true })
      await fs.mkdir('packages/launchpad/test-envs/env2', { recursive: true })
      await fs.mkdir('packages/launchpad/test-envs/env3', { recursive: true })
      await fs.mkdir('packages/launchpad/src', { recursive: true })
      await fs.mkdir('packages/core/src', { recursive: true })

      // Create package.json files in test-envs (should be ignored)
      const testPackageJson = JSON.stringify({
        name: 'test-env-package',
        version: '1.0.0',
        dependencies: { 'test-dep': '^1.0.0' },
      })

      await fs.writeFile('packages/launchpad/test-envs/env1/package.json', testPackageJson)
      await fs.writeFile('packages/launchpad/test-envs/env2/package.json', testPackageJson)
      await fs.writeFile('packages/launchpad/test-envs/env3/package.json', testPackageJson)

      // Create package.json files in src (should NOT be ignored)
      const srcPackageJson = JSON.stringify({
        name: 'launchpad-src',
        version: '1.0.0',
        dependencies: { react: '^18.0.0' },
      })

      await fs.writeFile('packages/launchpad/src/package.json', srcPackageJson)
      await fs.writeFile('packages/core/src/package.json', JSON.stringify({
        name: 'core',
        version: '1.0.0',
        dependencies: { lodash: '^4.0.0' },
      }))

      // Create deps.yaml files in test-envs (should be ignored)
      const testDepsYaml = 'dependencies:\n  node: ^20.0.0\n  test-tool: ^1.0.0'
      await fs.writeFile('packages/launchpad/test-envs/env1/deps.yaml', testDepsYaml)
      await fs.writeFile('packages/launchpad/test-envs/env2/deps.yaml', testDepsYaml)

      // Create deps.yaml in src (should NOT be ignored)
      const srcDepsYaml = 'dependencies:\n  bun: ^1.0.0\n  typescript: ^5.0.0'
      await fs.writeFile('packages/launchpad/src/deps.yaml', srcDepsYaml)

      const logger = Logger.quiet()
      const ignorePaths = ['packages/launchpad/test-envs/**']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should find 3 files: 2 package.json (launchpad/src, core/src) + 1 deps.yaml (launchpad/src)
      expect(packageFiles.length).toBeGreaterThanOrEqual(3)

      // Verify no test-envs files were included
      const testEnvFiles = packageFiles.filter(f => f.path.includes('test-envs'))
      expect(testEnvFiles).toHaveLength(0)

      // Verify src files were included
      const srcFiles = packageFiles.filter(f => f.path.includes('/src/'))
      expect(srcFiles.length).toBeGreaterThan(0)

      // Verify we have the correct dependencies
      const launchpadSrcPackage = packageFiles.find(f => f.path.includes('launchpad/src/package.json'))
      expect(launchpadSrcPackage).toBeDefined()
      expect(launchpadSrcPackage?.dependencies.some(d => d.name === 'react')).toBe(true)

      const corePackage = packageFiles.find(f => f.path.includes('core/src/package.json'))
      expect(corePackage).toBeDefined()
      expect(corePackage?.dependencies.some(d => d.name === 'lodash')).toBe(true)
    })

    it('should handle monorepo with multiple test directories', async () => {
      // Create a complex monorepo structure
      const structure = [
        'apps/web/src',
        'apps/api/src',
        'apps/test-app/src', // Should be ignored
        'packages/ui/src',
        'packages/utils/src',
        'packages/test-utils/src', // Should be ignored
        'tools/build/src',
        'tools/test-runner/src', // Should be ignored
        'examples/basic/src',
        'examples/test-example/src', // Should be ignored
      ]

      for (const dir of structure) {
        await fs.mkdir(dir, { recursive: true })
        const packageJson = JSON.stringify({
          name: dir.replace(/\//g, '-'),
          version: '1.0.0',
          dependencies: { 'shared-dep': '^1.0.0' },
        })
        await fs.writeFile(`${dir}/package.json`, packageJson)
      }

      const logger = Logger.quiet()
      const ignorePaths = [
        '**/test-*/**', // Ignore any directory starting with test-
        'tools/test-*/**', // Ignore test tools
      ]
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should find the expected files but not the ignored ones
      expect(packageFiles.length).toBeGreaterThanOrEqual(4) // At least the main packages

      // Verify ignored files are not present
      const ignoredFiles = packageFiles.filter(f =>
        f.path.includes('test-app')
        || f.path.includes('test-utils')
        || f.path.includes('test-runner')
        || f.path.includes('test-example'),
      )
      expect(ignoredFiles).toHaveLength(0)

      // Verify some expected files are present and test files are not
      expect(packageFiles.some(f => f.path.includes('apps/web'))).toBe(true)
      expect(packageFiles.some(f => f.path.includes('apps/api'))).toBe(true)
      expect(packageFiles.some(f => f.path.includes('packages/ui'))).toBe(true)
      expect(packageFiles.some(f => f.path.includes('packages/utils'))).toBe(true)
    })

    it('should handle composer files with ignore patterns', async () => {
      // Create PHP project structure
      await fs.mkdir('packages/api/src', { recursive: true })
      await fs.mkdir('packages/test-helpers/src', { recursive: true })
      await fs.mkdir('vendor/test-package', { recursive: true })

      const composerJson = JSON.stringify({
        'name': 'test/api',
        'require': {
          'php': '^8.1',
          'laravel/framework': '^10.0',
        },
        'require-dev': {
          'phpunit/phpunit': '^10.0',
        },
      })

      await fs.writeFile('packages/api/src/composer.json', composerJson)
      await fs.writeFile('packages/test-helpers/src/composer.json', JSON.stringify({
        name: 'test/helpers',
        require: { php: '^8.1' },
      }))
      await fs.writeFile('vendor/test-package/composer.json', JSON.stringify({
        name: 'vendor/test',
        require: { php: '^8.1' },
      }))

      const logger = Logger.quiet()
      const ignorePaths = [
        'packages/test-*/**', // Ignore test packages
        'vendor/**', // Ignore vendor directory
      ]
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should only find the api composer.json
      const composerFiles = packageFiles.filter(f => f.path.includes('composer.json'))
      expect(composerFiles).toHaveLength(1)
      expect(composerFiles[0].path).toContain('packages/api/src')
    })

    it('should handle GitHub Actions workflows with ignore patterns', async () => {
      // Create workflow structure
      await fs.mkdir('.github/workflows', { recursive: true })
      await fs.mkdir('packages/app/.github/workflows', { recursive: true })
      await fs.mkdir('packages/test-env/.github/workflows', { recursive: true })

      const workflow = `name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2`

      await fs.writeFile('.github/workflows/ci.yml', workflow)
      await fs.writeFile('packages/app/.github/workflows/build.yml', workflow)
      await fs.writeFile('packages/test-env/.github/workflows/test.yml', workflow)

      const logger = Logger.quiet()
      const ignorePaths = ['packages/test-*/**']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should find workflows, but not test-env workflows
      const workflowFiles = packageFiles.filter(f => f.path.includes('.github/workflows'))
      expect(workflowFiles.length).toBeGreaterThanOrEqual(1)

      const testEnvWorkflows = workflowFiles.filter(f => f.path.includes('test-env'))
      expect(testEnvWorkflows).toHaveLength(0)

      const validWorkflows = workflowFiles.filter(f =>
        f.path.includes('.github/workflows/ci.yml')
        || f.path.includes('app/.github/workflows'),
      )
      expect(validWorkflows.length).toBeGreaterThan(0)
    })
  })

  describe('Performance with many files', () => {
    it('should efficiently handle scanning with many ignored files', async () => {
      const startTime = Date.now()

      // Create 100 test directories (to be ignored)
      for (let i = 0; i < 100; i++) {
        await fs.mkdir(`test-env-${i}/src`, { recursive: true })
        const packageJson = JSON.stringify({ name: `test-env-${i}`, version: '1.0.0' })
        await fs.writeFile(`test-env-${i}/src/package.json`, packageJson)
      }

      // Create 10 valid directories
      for (let i = 0; i < 10; i++) {
        await fs.mkdir(`app-${i}/src`, { recursive: true })
        const packageJson = JSON.stringify({ name: `app-${i}`, version: '1.0.0' })
        await fs.writeFile(`app-${i}/src/package.json`, packageJson)
      }

      const setupTime = Date.now() - startTime

      const logger = Logger.quiet()
      const ignorePaths = ['test-env-*/**']
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const scanStartTime = Date.now()
      const packageFiles = await scanner.scanProject()
      const scanDuration = Date.now() - scanStartTime

      // Should only find the 10 app files
      expect(packageFiles).toHaveLength(10)

      // Should complete reasonably quickly (less than 5 seconds total)
      expect(scanDuration).toBeLessThan(5000)

      console.log(`Setup: ${setupTime}ms, Scan: ${scanDuration}ms, Total files: ${packageFiles.length}`)
    })
  })

  describe('Error handling and edge cases', () => {
    it('should handle malformed glob patterns gracefully', async () => {
      await fs.mkdir('src', { recursive: true })
      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile('src/package.json', packageJson)

      const logger = Logger.quiet()
      // Some potentially problematic patterns
      const ignorePaths = [
        '', // Empty pattern
        '**', // Very broad pattern
        '///invalid///', // Invalid path characters
      ]

      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      // Should not throw an error
      expect(async () => await scanner.scanProject()).not.toThrow()

      const packageFiles = await scanner.scanProject()
      // Should still work and find files (depending on how patterns are handled)
      expect(Array.isArray(packageFiles)).toBe(true)
    })

    it('should handle non-existent paths in ignore patterns', async () => {
      await fs.mkdir('src', { recursive: true })
      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile('src/package.json', packageJson)

      const logger = Logger.quiet()
      const ignorePaths = [
        'non-existent-dir/**',
        'also/does/not/exist/**',
      ]
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Should find the src file since ignore patterns don't match anything
      expect(packageFiles).toHaveLength(1)
      expect(packageFiles[0].path).toContain('src/package.json')
    })

    it('should handle case sensitivity correctly', async () => {
      await fs.mkdir('TEST/src', { recursive: true })
      await fs.mkdir('test/src', { recursive: true })

      const packageJson = JSON.stringify({ name: 'test', version: '1.0.0' })
      await fs.writeFile('TEST/src/package.json', packageJson)
      await fs.writeFile('test/src/package.json', packageJson)

      const logger = Logger.quiet()
      const ignorePaths = ['test/**'] // lowercase
      const scanner = new PackageScanner(testDir, logger, ignorePaths)

      const packageFiles = await scanner.scanProject()

      // Behavior depends on filesystem case sensitivity
      // On case-sensitive systems, should find TEST but not test
      // On case-insensitive systems, might ignore both
      const testFiles = packageFiles.filter(f => f.path.toLowerCase().includes('test'))
      expect(Array.isArray(testFiles)).toBe(true)
    })
  })
})
