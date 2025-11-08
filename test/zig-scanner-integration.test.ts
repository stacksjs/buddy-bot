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
})
