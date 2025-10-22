import { describe, expect, it } from 'bun:test'
import {
  generateZigManifestUpdates,
  isZigManifest,
  parseZigManifest,
  updateZigManifest,
} from '../src/utils/zig-parser'

describe('Zig Parser', () => {
  describe('isZigManifest', () => {
    it('should identify build.zig.zon files correctly', () => {
      expect(isZigManifest('build.zig.zon')).toBe(true)
      expect(isZigManifest('./build.zig.zon')).toBe(true)
      expect(isZigManifest('path/to/build.zig.zon')).toBe(true)
      expect(isZigManifest('/absolute/path/build.zig.zon')).toBe(true)
      expect(isZigManifest('packages/zig/build.zig.zon')).toBe(true)
    })

    it('should reject non-zig manifest files', () => {
      expect(isZigManifest('build.zig')).toBe(false)
      expect(isZigManifest('package.json')).toBe(false)
      expect(isZigManifest('composer.json')).toBe(false)
      expect(isZigManifest('build.zon')).toBe(false)
      expect(isZigManifest('zig.zon')).toBe(false)
      expect(isZigManifest('build.zig.zon.backup')).toBe(false)
    })
  })

  describe('parseZigManifest', () => {
    it('should parse valid build.zig.zon with dependencies', async () => {
      const zigContent = `.{
    .name = "zyte",
    .version = "0.1.0",
    .minimum_zig_version = "0.14.0",

    .dependencies = .{
        .httpz = .{
            .url = "https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz",
            .hash = "1220d97448c39e7d379a92e73b6acbaa4c63eb0e1d9f5ca53b5f8c0e85843cf6",
        },
        .zap = .{
            .url = "https://github.com/zigzap/zap/archive/refs/tags/v0.5.1.tar.gz",
            .hash = "12209e8c7d0e6f3e5c4e3b8c0e85843cf6d97448c39e7d379a92e73b6acbaa4c",
        },
    },

    .paths = .{
        "build.zig",
        "build.zig.zon",
        "src",
    },
}`

      const result = await parseZigManifest('build.zig.zon', zigContent)

      expect(result).not.toBeNull()
      expect(result!.path).toBe('build.zig.zon')
      expect(result!.type).toBe('build.zig.zon')
      expect(result!.content).toBe(zigContent)

      // Should extract dependencies
      const packageNames = result!.dependencies.map(dep => dep.name)
      expect(packageNames).toContain('httpz')
      expect(packageNames).toContain('zap')
      expect(result!.dependencies).toHaveLength(2)

      // Check dependency details
      const httpzDep = result!.dependencies.find(dep => dep.name === 'httpz')
      expect(httpzDep).toBeDefined()
      expect(httpzDep!.currentVersion).toBe('0.6.0')
      expect(httpzDep!.type).toBe('zig-dependencies')
      expect(httpzDep!.file).toBe('build.zig.zon')
      expect(httpzDep!.metadata?.url).toBe('https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz')
      expect(httpzDep!.metadata?.hash).toBe('1220d97448c39e7d379a92e73b6acbaa4c63eb0e1d9f5ca53b5f8c0e85843cf6')

      const zapDep = result!.dependencies.find(dep => dep.name === 'zap')
      expect(zapDep).toBeDefined()
      expect(zapDep!.currentVersion).toBe('0.5.1')
    })

    it('should parse build.zig.zon with no dependencies', async () => {
      const zigContent = `.{
    .name = "empty-project",
    .version = "0.1.0",
    .minimum_zig_version = "0.14.0",

    .paths = .{
        "build.zig",
        "build.zig.zon",
        "src",
    },
}`

      const result = await parseZigManifest('build.zig.zon', zigContent)

      expect(result).not.toBeNull()
      expect(result!.dependencies).toHaveLength(0)
    })

    it('should handle version extraction from different URL formats', async () => {
      const zigContent = `.{
    .name = "test",
    .version = "0.1.0",

    .dependencies = .{
        .lib1 = .{
            .url = "https://github.com/user/repo/archive/refs/tags/v1.2.3.tar.gz",
            .hash = "1220abcd",
        },
        .lib2 = .{
            .url = "https://github.com/user/repo/archive/2.0.0.tar.gz",
            .hash = "1220efgh",
        },
        .lib3 = .{
            .url = "https://example.com/package/0.5.0-beta.1/download.tar.gz",
            .hash = "1220ijkl",
        },
    },
}`

      const result = await parseZigManifest('build.zig.zon', zigContent)

      expect(result).not.toBeNull()
      expect(result!.dependencies).toHaveLength(3)

      const lib1 = result!.dependencies.find(dep => dep.name === 'lib1')
      expect(lib1!.currentVersion).toBe('1.2.3')

      const lib2 = result!.dependencies.find(dep => dep.name === 'lib2')
      expect(lib2!.currentVersion).toBe('2.0.0')

      const lib3 = result!.dependencies.find(dep => dep.name === 'lib3')
      expect(lib3!.currentVersion).toBe('0.5.0-beta.1')
    })

    it('should handle dependencies without version in URL', async () => {
      const zigContent = `.{
    .name = "test",
    .version = "0.1.0",

    .dependencies = .{
        .unknown = .{
            .url = "https://github.com/user/repo/archive/main.tar.gz",
            .hash = "1220abcd",
        },
    },
}`

      const result = await parseZigManifest('build.zig.zon', zigContent)

      expect(result).not.toBeNull()
      expect(result!.dependencies).toHaveLength(1)
      expect(result!.dependencies[0].currentVersion).toBe('unknown')
    })

    it('should handle malformed content gracefully', async () => {
      const malformedContent = '.{ invalid zig syntax'

      const result = await parseZigManifest('build.zig.zon', malformedContent)

      // Should not crash, might return empty or null
      expect(result).toBeDefined()
    })
  })

  describe('updateZigManifest', () => {
    it('should update single dependency version in URL', async () => {
      const originalContent = `.{
    .name = "test",
    .version = "0.1.0",

    .dependencies = .{
        .httpz = .{
            .url = "https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz",
            .hash = "1220d97448c39e7d379a92e73b6acbaa4c63eb0e1d9f5ca53b5f8c0e85843cf6",
        },
    },
}`

      const updates = [{
        name: 'httpz',
        currentVersion: '0.6.0',
        newVersion: '0.7.0',
        updateType: 'minor' as const,
        dependencyType: 'zig-dependencies' as const,
        file: 'build.zig.zon',
      }]

      const result = await updateZigManifest('build.zig.zon', originalContent, updates)

      expect(result).toContain('v0.7.0')
      expect(result).not.toContain('v0.6.0')
      expect(result).toContain('https://github.com/karlseguin/http.zig/archive/refs/tags/v0.7.0.tar.gz')
    })

    it('should update multiple dependencies', async () => {
      const originalContent = `.{
    .name = "test",
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
    },
}`

      const updates = [
        {
          name: 'httpz',
          currentVersion: '0.6.0',
          newVersion: '0.7.0',
          updateType: 'minor' as const,
          dependencyType: 'zig-dependencies' as const,
          file: 'build.zig.zon',
        },
        {
          name: 'zap',
          currentVersion: '0.5.1',
          newVersion: '0.6.0',
          updateType: 'minor' as const,
          dependencyType: 'zig-dependencies' as const,
          file: 'build.zig.zon',
        },
      ]

      const result = await updateZigManifest('build.zig.zon', originalContent, updates)

      expect(result).toContain('v0.7.0')
      expect(result).toContain('v0.6.0')
      expect(result).not.toContain('v0.5.1')
      expect(result).toContain('https://github.com/karlseguin/http.zig/archive/refs/tags/v0.7.0.tar.gz')
      expect(result).toContain('https://github.com/zigzap/zap/archive/refs/tags/v0.6.0.tar.gz')
    })

    it('should preserve v prefix in version if present', async () => {
      const originalContent = `.{
    .dependencies = .{
        .lib = .{
            .url = "https://github.com/user/repo/archive/refs/tags/v1.0.0.tar.gz",
            .hash = "1220abcd",
        },
    },
}`

      const updates = [{
        name: 'lib',
        currentVersion: '1.0.0',
        newVersion: '2.0.0',
        updateType: 'major' as const,
        dependencyType: 'zig-dependencies' as const,
        file: 'build.zig.zon',
      }]

      const result = await updateZigManifest('build.zig.zon', originalContent, updates)

      expect(result).toContain('v2.0.0')
      expect(result).not.toContain('v1.0.0')
    })

    it('should handle version without v prefix', async () => {
      const originalContent = `.{
    .dependencies = .{
        .lib = .{
            .url = "https://github.com/user/repo/archive/1.0.0.tar.gz",
            .hash = "1220abcd",
        },
    },
}`

      const updates = [{
        name: 'lib',
        currentVersion: '1.0.0',
        newVersion: '2.0.0',
        updateType: 'major' as const,
        dependencyType: 'zig-dependencies' as const,
        file: 'build.zig.zon',
      }]

      const result = await updateZigManifest('build.zig.zon', originalContent, updates)

      expect(result).toContain('/2.0.0')
      expect(result).not.toContain('/1.0.0')
      expect(result).not.toContain('v2.0.0') // Should not add v prefix if it wasn't there
    })

    it('should not modify file for non-zig manifest', async () => {
      const content = 'some other file content'
      const result = await updateZigManifest('package.json', content, [])

      expect(result).toBe(content)
    })

    it('should preserve formatting and structure', async () => {
      const originalContent = `.{
    .name = "test",
    .version = "0.1.0",

    .dependencies = .{
        .httpz = .{
            .url = "https://github.com/karlseguin/http.zig/archive/refs/tags/v0.6.0.tar.gz",
            .hash = "1220d97448c39e7d379a92e73b6acbaa4c63eb0e1d9f5ca53b5f8c0e85843cf6",
        },
    },

    .paths = .{
        "build.zig",
        "src",
    },
}`

      const updates = [{
        name: 'httpz',
        currentVersion: '0.6.0',
        newVersion: '0.7.0',
        updateType: 'minor' as const,
        dependencyType: 'zig-dependencies' as const,
        file: 'build.zig.zon',
      }]

      const result = await updateZigManifest('build.zig.zon', originalContent, updates)

      // Should preserve structure
      expect(result).toContain('.name = "test"')
      expect(result).toContain('.version = "0.1.0"')
      expect(result).toContain('.paths = .{')
      expect(result).toContain('"build.zig"')

      // Should update version
      expect(result).toContain('v0.7.0')
    })
  })

  describe('generateZigManifestUpdates', () => {
    it('should generate updates for Zig manifest files', async () => {
      // This test would require filesystem access
      // Skipping for now as it needs actual file I/O
    })
  })
})
