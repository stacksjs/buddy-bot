import type { Logger } from '../src/utils/logger'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PackageScanner } from '../src/scanner/package-scanner'

describe('PackageScanner - Zig Integration', () => {
  const testDir = join(process.cwd(), 'test', 'tmp', 'zig-scanner-test')
  let scanner: PackageScanner
  let mockLogger: Logger

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    mkdirSync(testDir, { recursive: true })

    // Create a mock logger
    mockLogger = {
      info: mock(),
      warn: mock(),
      error: mock(),
      success: mock(),
      debug: mock(),
    } as unknown as Logger

    scanner = new PackageScanner(testDir, mockLogger)
  })

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe('Zig manifest detection', () => {
    it('should detect and parse build.zig.zon files', async () => {
      const zigContent = `.{
    .name = "test-project",
    .version = "0.1.0",
    .minimum_zig_version = "0.14.0",

    .dependencies = .{
        .httpz = .{
            .url = "https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz",
            .hash = "1220d97448c39e7d379a92e73b6acbaa4c63eb0e1d9f5ca53b5f8c0e85843cf6",
        },
    },

    .paths = .{
        "build.zig",
        "build.zig.zon",
        "src",
    },
}`

      writeFileSync(join(testDir, 'build.zig.zon'), zigContent)

      const result = await scanner.scanProject()

      const zigFile = result.find(f => f.path === 'build.zig.zon')
      expect(zigFile).toBeDefined()
      expect(zigFile?.type).toBe('build.zig.zon')
      expect(zigFile?.dependencies).toHaveLength(1)
      expect(zigFile?.dependencies[0].name).toBe('httpz')
      expect(zigFile?.dependencies[0].currentVersion).toBe('0.6.0')
      expect(zigFile?.dependencies[0].type).toBe('zig-dependencies')
    })

    it('should detect build.zig.zon in subdirectories', async () => {
      const packagesDir = join(testDir, 'packages', 'zig')
      mkdirSync(packagesDir, { recursive: true })

      const zigContent = `.{
    .name = "nested-project",
    .version = "0.1.0",

    .dependencies = .{
        .zap = .{
            .url = "https://github.com/zigzap/zap/archive/refs/tags/v0.5.1.tar.gz",
            .hash = "12209e8c7d0e6f3e5c4e3b8c0e85843cf6d97448c39e7d379a92e73b6acbaa4c",
        },
    },
}`

      const zigFilePath = join(packagesDir, 'build.zig.zon')
      writeFileSync(zigFilePath, zigContent)

      // Verify file was created
      if (!existsSync(zigFilePath)) {
        throw new Error(`Failed to create test file: ${zigFilePath}`)
      }

      const result = await scanner.scanProject()

      // Debug: log all found files
      if (!result.find(f => f.path.includes('build.zig.zon'))) {
        console.error('Debug - All scanned files:', result.map(f => f.path))
        console.error('Debug - testDir:', testDir)
        console.error('Debug - zigFilePath:', zigFilePath)
      }

      const zigFile = result.find(f => f.path.includes('build.zig.zon'))
      expect(zigFile).toBeDefined()
      expect(zigFile?.dependencies).toHaveLength(1)
      expect(zigFile?.dependencies[0].name).toBe('zap')
      expect(zigFile?.dependencies[0].currentVersion).toBe('0.5.1')
    })

    it('should handle build.zig.zon with multiple dependencies', async () => {
      const zigContent = `.{
    .name = "multi-deps",
    .version = "0.1.0",

    .dependencies = .{
        .httpz = .{
            .url = "https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz",
            .hash = "1220abcd",
        },
        .zap = .{
            .url = "https://github.com/zigzap/zap/archive/refs/tags/v0.5.1.tar.gz",
            .hash = "1220efgh",
        },
        .known_folders = .{
            .url = "https://github.com/ziglibs/known-folders/archive/refs/tags/v1.0.0.tar.gz",
            .hash = "1220ijkl",
        },
    },
}`

      writeFileSync(join(testDir, 'build.zig.zon'), zigContent)

      const result = await scanner.scanProject()

      const zigFile = result.find(f => f.path === 'build.zig.zon')
      expect(zigFile).toBeDefined()
      expect(zigFile?.dependencies).toHaveLength(3)

      const depNames = zigFile?.dependencies.map(d => d.name) || []
      expect(depNames).toContain('httpz')
      expect(depNames).toContain('zap')
      expect(depNames).toContain('known_folders')
    })

    it('should handle build.zig.zon with no dependencies', async () => {
      const zigContent = `.{
    .name = "no-deps",
    .version = "0.1.0",
    .minimum_zig_version = "0.14.0",

    .paths = .{
        "build.zig",
        "build.zig.zon",
        "src",
    },
}`

      writeFileSync(join(testDir, 'build.zig.zon'), zigContent)

      const result = await scanner.scanProject()

      const zigFile = result.find(f => f.path === 'build.zig.zon')
      expect(zigFile).toBeDefined()
      expect(zigFile?.dependencies).toHaveLength(0)
    })

    it('should scan both package.json and build.zig.zon together', async () => {
      const packageJsonContent = JSON.stringify({
        name: 'hybrid-project',
        dependencies: {
          lodash: '^4.17.21',
        },
      })

      const zigContent = `.{
    .name = "hybrid",
    .version = "0.1.0",

    .dependencies = .{
        .httpz = .{
            .url = "https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz",
            .hash = "1220abcd",
        },
    },
}`

      const packageJsonPath = join(testDir, 'package.json')
      const zigFilePath = join(testDir, 'build.zig.zon')
      writeFileSync(packageJsonPath, packageJsonContent)
      writeFileSync(zigFilePath, zigContent)

      // Verify files were created
      if (!existsSync(packageJsonPath)) {
        throw new Error(`Failed to create test file: ${packageJsonPath}`)
      }
      if (!existsSync(zigFilePath)) {
        throw new Error(`Failed to create test file: ${zigFilePath}`)
      }

      const result = await scanner.scanProject()

      // Debug: log all found files if expected files are missing
      if (!result.find(f => f.path === 'package.json') || !result.find(f => f.path === 'build.zig.zon')) {
        console.error('Debug - All scanned files:', result.map(f => f.path))
        console.error('Debug - Expected package.json and build.zig.zon')
      }

      const packageJsonFile = result.find(f => f.path === 'package.json')
      const zigFile = result.find(f => f.path === 'build.zig.zon')

      expect(packageJsonFile).toBeDefined()
      expect(packageJsonFile?.dependencies).toHaveLength(1)

      expect(zigFile).toBeDefined()
      expect(zigFile?.dependencies).toHaveLength(1)

      expect(result).toHaveLength(2)
    })

    it('should preserve metadata (URL and hash) for Zig dependencies', async () => {
      const zigContent = `.{
    .name = "test",
    .version = "0.1.0",

    .dependencies = .{
        .httpz = .{
            .url = "https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz",
            .hash = "1220d97448c39e7d379a92e73b6acbaa4c63eb0e1d9f5ca53b5f8c0e85843cf6",
        },
    },
}`

      writeFileSync(join(testDir, 'build.zig.zon'), zigContent)

      const result = await scanner.scanProject()

      const zigFile = result.find(f => f.path === 'build.zig.zon')
      expect(zigFile?.dependencies[0].metadata).toBeDefined()
      expect(zigFile?.dependencies[0].metadata?.url).toBe('https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz')
      expect(zigFile?.dependencies[0].metadata?.hash).toBe('1220d97448c39e7d379a92e73b6acbaa4c63eb0e1d9f5ca53b5f8c0e85843cf6')
    })

    it('should not detect build.zig files as manifests', async () => {
      const buildZigContent = `const std = @import("std");

pub fn build(b: *std.Build) void {
    // Build script content
}`

      writeFileSync(join(testDir, 'build.zig'), buildZigContent)

      const result = await scanner.scanProject()

      const buildZigFile = result.find(f => f.path === 'build.zig')
      expect(buildZigFile).toBeUndefined()
    })
  })

  describe('Zig manifest in monorepo structure', () => {
    it('should detect multiple build.zig.zon files in monorepo', async () => {
      // Create packages structure
      const package1Dir = join(testDir, 'packages', 'lib1')
      const package2Dir = join(testDir, 'packages', 'lib2')
      mkdirSync(package1Dir, { recursive: true })
      mkdirSync(package2Dir, { recursive: true })

      const zigContent1 = `.{
    .name = "lib1",
    .version = "0.1.0",

    .dependencies = .{
        .httpz = .{
            .url = "https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz",
            .hash = "1220abcd",
        },
    },
}`

      const zigContent2 = `.{
    .name = "lib2",
    .version = "0.2.0",

    .dependencies = .{
        .zap = .{
            .url = "https://github.com/zigzap/zap/archive/refs/tags/v0.5.1.tar.gz",
            .hash = "1220efgh",
        },
    },
}`

      const zigFile1Path = join(package1Dir, 'build.zig.zon')
      const zigFile2Path = join(package2Dir, 'build.zig.zon')
      writeFileSync(zigFile1Path, zigContent1)
      writeFileSync(zigFile2Path, zigContent2)

      // Verify files were created
      if (!existsSync(zigFile1Path)) {
        throw new Error(`Failed to create test file: ${zigFile1Path}`)
      }
      if (!existsSync(zigFile2Path)) {
        throw new Error(`Failed to create test file: ${zigFile2Path}`)
      }

      const result = await scanner.scanProject()

      // Debug: log all found files if expected count doesn't match
      const zigFiles = result.filter(f => f.type === 'build.zig.zon')
      if (zigFiles.length !== 2) {
        console.error('Debug - All scanned files:', result.map(f => ({ path: f.path, type: f.type })))
        console.error('Debug - Zig files found:', zigFiles.length)
        console.error('Debug - testDir:', testDir)
        console.error('Debug - package1Dir:', package1Dir)
        console.error('Debug - package2Dir:', package2Dir)
      }

      expect(zigFiles).toHaveLength(2)

      const lib1File = zigFiles.find(f => f.path.includes('lib1'))
      const lib2File = zigFiles.find(f => f.path.includes('lib2'))

      expect(lib1File).toBeDefined()
      expect(lib1File?.dependencies[0].name).toBe('httpz')

      expect(lib2File).toBeDefined()
      expect(lib2File?.dependencies[0].name).toBe('zap')
    })
  })
})
