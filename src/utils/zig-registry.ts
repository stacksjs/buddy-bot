import { getGitHubApiUrl } from './endpoints'
import { fetchWithTimeout } from './http'
import { getDefaultLogger } from './logger'

/** A GitHub-hosted Zig dependency, parsed out of its tarball URL. */
export interface ZigSource {
  owner: string
  repo: string
  /** Version embedded in the URL, without any `v` prefix */
  version: string
  /** Whether the tag in the URL carried a `v` prefix */
  hasVPrefix: boolean
}

/**
 * Parse the owner, repository and version out of a Zig dependency URL.
 *
 * Zig manifests point at tarballs rather than a registry, so the upstream
 * project has to be recovered from the URL. Only GitHub URLs are recognised —
 * other hosts have no uniform way to enumerate releases.
 *
 * @param url - The `.url` field of a dependency
 * @returns The parsed source, or `null` when the URL is not a GitHub tarball
 * @example
 * ```ts
 * parseZigSource('https://github.com/zigimg/zigimg/archive/refs/tags/v0.1.0.tar.gz')
 * // => { owner: 'zigimg', repo: 'zigimg', version: '0.1.0', hasVPrefix: true }
 * ```
 */
export function parseZigSource(url: string): ZigSource | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/(?:archive|releases\/download)\/(?:refs\/tags\/)?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i)
  if (!match)
    return null

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
    version: match[3],
    hasVPrefix: /\/v\d/.test(url),
  }
}

/**
 * Look up the latest release tag for a GitHub-hosted Zig dependency.
 *
 * @param source - Parsed dependency source
 * @param token - GitHub token, raising the anonymous rate limit when present
 * @returns The latest version without a `v` prefix, or `null` when unavailable
 */
export async function fetchLatestZigVersion(source: ZigSource, token?: string): Promise<string | null> {
  const logger = getDefaultLogger()

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'buddy-bot',
    }
    if (token)
      headers.Authorization = `Bearer ${token}`

    const response = await fetchWithTimeout(
      `${getGitHubApiUrl()}/repos/${source.owner}/${source.repo}/releases/latest`,
      { headers },
    )

    if (!response.ok) {
      logger.debug(`No latest release for ${source.owner}/${source.repo}: ${response.status}`)
      return null
    }

    const release = await response.json() as { tag_name?: string }
    if (!release.tag_name)
      return null

    const version = release.tag_name.replace(/^v/, '')
    return /^\d+\.\d+\.\d+/.test(version) ? version : null
  }
  catch (error) {
    logger.debug(`Failed to fetch latest Zig version for ${source.owner}/${source.repo}: ${error}`)
    return null
  }
}

/**
 * Build the tarball URL for a new version, preserving the original URL's shape.
 *
 * @param url - The current `.url` value
 * @param newVersion - Version to point at
 */
export function zigUrlForVersion(url: string, newVersion: string): string {
  return url.replace(/\/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i, match =>
    match.startsWith('/v') ? `/v${newVersion}` : `/${newVersion}`)
}

/**
 * Whether the `zig` toolchain is available on this machine.
 *
 * Zig package hashes are content-addressed, so a manifest whose URL moved but
 * whose hash did not will fail `zig build` with a hash mismatch. Only `zig
 * fetch` can compute the replacement, which makes its availability a
 * precondition for proposing Zig updates at all.
 */
export async function isZigAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['zig', 'version'], { stdout: 'pipe', stderr: 'pipe' })
    return await proc.exited === 0
  }
  catch {
    return false
  }
}

/**
 * Compute the Zig package hash for a tarball URL using `zig fetch`.
 *
 * @param url - Tarball URL to fetch
 * @returns The multihash string, or `null` when zig is unavailable or the
 * fetch failed
 */
export async function fetchZigHash(url: string): Promise<string | null> {
  const logger = getDefaultLogger()

  try {
    const proc = Bun.spawn(['zig', 'fetch', url], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      logger.warn(`⚠️ zig fetch failed for ${url}: ${stderr.trim()}`)
      return null
    }

    const hash = stdout.trim()
    return hash.length > 0 ? hash : null
  }
  catch (error) {
    logger.warn(`⚠️ Could not run zig fetch for ${url}: ${error}`)
    return null
  }
}
