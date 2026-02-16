import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PackageScanner } from '../src/scanner/package-scanner'
import { Logger } from '../src/utils/logger'

describe('PackageScanner - Dependency Files Integration', () => {
  let testDir: string
  const logger = Logger.quiet()

  const packageJsonContent = JSON.stringify({
    name: 'test-project',
    dependencies: {
      lodash: '^4.17.21',
    },
  })

  // Use simple package names (no dots) that the fallback YAML parser can handle.
  // The fallback regex [\w@/-]+ is used when ts-pkgx can't resolve the file
  // (e.g., in CI where the file isn't at cwd).
  const depsYamlContent = `dependencies:
  react: ^18.0.0
  typescript: ^5.0.0`

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), 'buddy-scanner-test-'))
  })

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  /**
   * Helper: create a fresh project directory with given files
   */
  function createProjectDir(files: Record<string, string>): string {
    const projectDir = mkdtempSync(join(testDir, 'project-'))
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(projectDir, relativePath)
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      if (dir !== projectDir)
        mkdirSync(dir, { recursive: true })
      writeFileSync(fullPath, content)
    }
    return projectDir
  }

  describe('scanProject with dependency files', () => {
    it('should scan and include both package.json and dependency files', async () => {
      const projectDir = createProjectDir({
        'package.json': packageJsonContent,
        'deps.yaml': depsYamlContent,
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      const packageJsonFile = result.find(f => f.path === 'package.json')
      const depsYamlFile = result.find(f => f.path === 'deps.yaml')

      expect(packageJsonFile).toBeDefined()
      expect(packageJsonFile?.type).toBe('package.json')
      expect(packageJsonFile?.dependencies.length).toBeGreaterThanOrEqual(1)

      expect(depsYamlFile).toBeDefined()
      expect(depsYamlFile?.type).toBe('deps.yaml')
      expect(depsYamlFile?.dependencies.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle multiple dependency file types', async () => {
      const dependencyFileNames = [
        'deps.yaml',
        'deps.yml',
        'dependencies.yaml',
        'dependencies.yml',
        'pkgx.yaml',
        'pkgx.yml',
        '.deps.yaml',
        '.deps.yml',
      ]

      const files: Record<string, string> = {
        'package.json': packageJsonContent,
      }
      for (const name of dependencyFileNames) {
        files[name] = depsYamlContent
      }

      const projectDir = createProjectDir(files)
      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      // Should find package.json plus all dependency files
      const lockTypes = ['bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'] as const
      const depFiles = result.filter(f => f.type !== 'package.json' && !lockTypes.includes(f.type as any))
      expect(depFiles.length).toBeGreaterThanOrEqual(dependencyFileNames.length)

      // Verify each dependency file type was found
      for (const fileName of dependencyFileNames) {
        const file = result.find(f => f.path === fileName)
        expect(file).toBeDefined()
      }
    })

    it('should handle nested dependency files', async () => {
      const projectDir = createProjectDir({
        'package.json': packageJsonContent,
        'config/deps.yaml': depsYamlContent,
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      // The scanner should discover the nested deps.yaml file
      const nestedDepsFile = result.find(f => f.path.includes('config/deps.yaml'))
      expect(nestedDepsFile).toBeDefined()
      // Note: ts-pkgx may not resolve dependencies from nested paths via fallback parsing,
      // but the file should still be discovered and included in the results
      expect(nestedDepsFile?.type).toBe('deps.yaml')
    })

    it('should skip node_modules and other ignored directories', async () => {
      const projectDir = createProjectDir({
        'package.json': packageJsonContent,
        'deps.yaml': depsYamlContent,
        'node_modules/some-pkg/deps.yaml': depsYamlContent,
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      // Should find root deps.yaml but not node_modules/some-pkg/deps.yaml
      const depsFiles = result.filter(f => f.path.includes('deps.yaml'))
      expect(depsFiles.length).toBe(1)
      expect(depsFiles[0].path).toBe('deps.yaml')
    })

    it('should handle dependency file parsing errors gracefully', async () => {
      const projectDir = createProjectDir({
        'package.json': packageJsonContent,
        'deps.yaml': '!!!invalid: yaml: [[[content',
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      // Should still include package.json even if deps.yaml fails to parse
      const packageJsonFile = result.find(f => f.path === 'package.json')
      expect(packageJsonFile).toBeDefined()
    })

    it('should handle file read errors gracefully', async () => {
      const projectDir = createProjectDir({
        'package.json': packageJsonContent,
      })
      // Create a directory named deps.yaml (which will cause a read error)
      mkdirSync(join(projectDir, 'deps.yaml'), { recursive: true })
      writeFileSync(join(projectDir, 'deps.yaml', 'dummy'), 'placeholder')

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      // Should still return package.json results
      const packageJsonFile = result.find(f => f.path === 'package.json')
      expect(packageJsonFile).toBeDefined()
    })
  })

  describe('findDependencyFiles', () => {
    it('should find dependency files by pattern matching', async () => {
      const projectDir = createProjectDir({
        'deps.yaml': depsYamlContent,
        'config.yaml': 'some: config',
        'docker-compose.yml': 'version: "3"',
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      // Should find deps.yaml but not config.yaml or docker-compose.yml as dependency files
      const depFileTypes = result.map(f => f.type)
      expect(depFileTypes).toContain('deps.yaml')
      expect(depFileTypes).not.toContain('config.yaml')
      expect(depFileTypes).not.toContain('docker-compose.yml')
    })
  })

  describe('parseDependencyFile method', () => {
    it('should call dependency file parser correctly', async () => {
      const projectDir = createProjectDir({
        'deps.yaml': depsYamlContent,
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.parseDependencyFile('deps.yaml')

      expect(result).not.toBeNull()
      expect(result?.path).toBe('deps.yaml')
      expect(result?.dependencies.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle file read errors', async () => {
      const projectDir = createProjectDir({})

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.parseDependencyFile('nonexistent.yaml')

      expect(result).toBeNull()
    })

    it('should handle parser errors', async () => {
      const projectDir = createProjectDir({
        'broken.yaml': '!!!invalid: yaml: content: [[[',
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.parseDependencyFile('broken.yaml')

      // Should return null on parse errors
      expect(result).toBeNull()
    })
  })

  describe('integration with existing package.json scanning', () => {
    it('should not interfere with existing package.json functionality', async () => {
      const projectDir = createProjectDir({
        'package.json': packageJsonContent,
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      const packageJsonFile = result.find(f => f.type === 'package.json')
      expect(packageJsonFile).toBeDefined()
      expect(packageJsonFile?.dependencies).toBeDefined()
      expect(packageJsonFile?.dependencies.length).toBeGreaterThanOrEqual(1)
    })

    it('should correctly combine package.json and dependency file results', async () => {
      const projectDir = createProjectDir({
        'package.json': packageJsonContent,
        'deps.yaml': depsYamlContent,
      })

      const scanner = new PackageScanner(projectDir, logger)
      const result = await scanner.scanProject()

      const packageJsonFile = result.find(f => f.type === 'package.json')
      const depsFile = result.find(f => f.path === 'deps.yaml')

      expect(packageJsonFile).toBeDefined()
      expect(depsFile).toBeDefined()

      // Both should have dependencies
      const totalDependencies = (packageJsonFile?.dependencies.length ?? 0) + (depsFile?.dependencies.length ?? 0)
      expect(totalDependencies).toBeGreaterThanOrEqual(2) // at least 1 from package.json + 1 from deps.yaml
    })
  })
})
