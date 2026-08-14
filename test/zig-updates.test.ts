import type { PackageUpdate } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { updateZigManifest } from '../src/utils/zig-parser'
import { parseZigSource, zigUrlForVersion } from '../src/utils/zig-registry'

const MANIFEST = `.{
    .name = "example",
    .version = "0.1.0",
    .dependencies = .{
        .zigimg = .{
            .url = "https://github.com/zigimg/zigimg/archive/refs/tags/v0.1.0.tar.gz",
            .hash = "1220oldhasholdhasholdhasholdhasholdhasholdhasholdhash000000000000",
        },
    },
}
`

function makeUpdate(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'zigimg',
    currentVersion: '0.1.0',
    newVersion: '0.2.0',
    updateType: 'minor',
    dependencyType: 'zig-dependencies',
    file: 'build.zig.zon',
    ...overrides,
  }
}

describe('zig dependency updates', () => {
  describe('parseZigSource', () => {
    it('success case - parses an archive tag URL', () => {
      const source = parseZigSource('https://github.com/zigimg/zigimg/archive/refs/tags/v0.1.0.tar.gz')

      expect(source).toEqual({ owner: 'zigimg', repo: 'zigimg', version: '0.1.0', hasVPrefix: true })
    })

    it('success case - parses a release download URL without a v prefix', () => {
      const source = parseZigSource('https://github.com/acme/lib/releases/download/1.2.3/lib.tar.gz')

      expect(source).toMatchObject({ owner: 'acme', repo: 'lib', version: '1.2.3', hasVPrefix: false })
    })

    it('failure case - returns null for a non-GitHub host', () => {
      expect(parseZigSource('https://example.com/pkg/v1.0.0.tar.gz')).toBeNull()
    })

    it('failure case - returns null when the URL carries no version', () => {
      expect(parseZigSource('https://github.com/acme/lib/archive/refs/heads/main.tar.gz')).toBeNull()
    })
  })

  describe('zigUrlForVersion', () => {
    it('success case - preserves the v prefix', () => {
      expect(zigUrlForVersion('https://github.com/a/b/archive/refs/tags/v0.1.0.tar.gz', '0.2.0'))
        .toBe('https://github.com/a/b/archive/refs/tags/v0.2.0.tar.gz')
    })

    it('success case - preserves the absence of a v prefix', () => {
      expect(zigUrlForVersion('https://github.com/a/b/releases/download/1.2.3/b.tar.gz', '1.3.0'))
        .toBe('https://github.com/a/b/releases/download/1.3.0/b.tar.gz')
    })
  })

  describe('updateZigManifest', () => {
    it('success case - rewrites both the URL and the hash', async () => {
      const update = makeUpdate({ resolved: { hash: '1220newhashnewhashnewhashnewhashnewhashnewhashnewhash111111111111' } })

      const result = await updateZigManifest('build.zig.zon', MANIFEST, [update])

      expect(result).toContain('v0.2.0.tar.gz')
      expect(result).toContain('1220newhashnewhashnewhash')
      expect(result).not.toContain('1220oldhasholdhash')
    })

    it('failure case - leaves the manifest untouched when no hash was resolved', async () => {
      // A URL bump with a stale hash fails `zig build` verification, so no
      // change at all is the correct outcome.
      const result = await updateZigManifest('build.zig.zon', MANIFEST, [makeUpdate()])

      expect(result).toBe(MANIFEST)
    })

    it('edge case - leaves other dependencies alone', async () => {
      const twoDeps = MANIFEST.replace(
        '    },\n}',
        `    },
        .other = .{
            .url = "https://github.com/acme/other/archive/refs/tags/v9.9.9.tar.gz",
            .hash = "1220otherhashotherhashotherhashotherhashotherhashotherhash0000000",
        },
    },
}`,
      )
      const update = makeUpdate({ resolved: { hash: '1220newhash' } })

      const result = await updateZigManifest('build.zig.zon', twoDeps, [update])

      expect(result).toContain('v9.9.9.tar.gz')
      expect(result).toContain('1220otherhashotherhash')
    })
  })
})
