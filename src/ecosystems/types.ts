import type { Logger } from '../utils/logger'

/** A dependency an adapter found in a manifest. */
export interface EcosystemDependency {
  name: string
  /** Version constraint exactly as written, operators included */
  currentVersion: string
  /** Which section of the manifest it came from */
  section: string
  /** Repository-relative manifest path */
  file: string
  /** Whatever the adapter needs to write the update back */
  metadata?: Record<string, string>
}

/** What a registry reported about a package. */
export interface VersionInfo {
  latest: string
  /** When that version was published, for `minimumReleaseAge` */
  publishedAt?: Date
  /** Whether the package is deprecated or yanked upstream */
  deprecated?: boolean
  /** Where to read what changed */
  releaseNotesUrl?: string
  homepage?: string
}

/** An update an adapter is asked to write. */
export interface EcosystemUpdate {
  name: string
  currentVersion: string
  newVersion: string
  section: string
  metadata?: Record<string, string>
}

/** Options a registry lookup honours. */
export interface LatestOptions {
  /** Consider pre-release versions */
  includePrerelease?: boolean
  /** Registry base URL override, for mirrors */
  registryUrl?: string
  logger?: Logger
}

/**
 * One dependency ecosystem, as a pluggable module.
 *
 * Each ecosystem owns its own manifest discovery, parsing, version comparison
 * and formatting-preserving writes. That last part is why the write is the
 * adapter's job rather than a shared one: every manifest format has its own
 * quoting, its own operator vocabulary, and a maintainer's formatting that a
 * naive rewrite would destroy.
 *
 * @example
 * ```ts
 * const files = await adapter.detect(process.cwd())
 * const deps = await adapter.parse(files[0], await Bun.file(files[0]).text())
 * ```
 */
export interface EcosystemAdapter {
  /** Stable identifier, used in config, reports and grouping */
  name: string

  /** Manifest filenames or globs this adapter reads */
  manifestPatterns: string[]

  /**
   * Find this ecosystem's manifests under a directory.
   *
   * @param dir - Directory to search
   * @returns Repository-relative manifest paths
   */
  detect: (dir: string) => Promise<string[]>

  /**
   * Extract dependencies from a manifest.
   *
   * @param file - Repository-relative path, for attribution
   * @param content - File content
   */
  parse: (file: string, content: string) => Promise<EcosystemDependency[]>

  /**
   * Look up a package's newest version.
   *
   * @param dependency - The dependency to resolve
   * @param options - Registry and pre-release behaviour
   * @returns The version info, or null when the package is unknown
   */
  latest: (dependency: EcosystemDependency, options?: LatestOptions) => Promise<VersionInfo | null>

  /**
   * Write an update into a manifest, preserving its formatting.
   *
   * Must return the content unchanged when the dependency is not found, so a
   * failed match is a no-op rather than a corrupted file.
   *
   * @param content - Current file content
   * @param update - The update to apply
   * @returns The updated content
   */
  applyUpdate: (content: string, update: EcosystemUpdate) => string

  /**
   * Regenerate lockfiles after manifests changed.
   *
   * Optional because not every ecosystem has one, and best-effort because the
   * toolchain may not be installed on the runner — a missing `cargo` should
   * produce a pull request that says the lockfile needs regenerating, not no
   * pull request at all.
   *
   * @param dir - Repository root
   * @returns What happened, for the pull request body
   */
  postWrite?: (dir: string) => Promise<{ regenerated: string[], note?: string }>

  /** OSV ecosystem name, when OSV indexes this ecosystem */
  osvEcosystem?: string

  /**
   * Compare two versions.
   *
   * Supplied per ecosystem because they genuinely differ: PEP 440 orders
   * `1.0.post1` above `1.0`, and semver has no such concept.
   *
   * @returns Negative when a precedes b, positive when it follows, 0 when equal
   */
  compareVersions: (a: string, b: string) => number

  /**
   * Classify an update.
   *
   * @param from - Current version
   * @param to - Proposed version
   */
  updateType: (from: string, to: string) => 'major' | 'minor' | 'patch'
}
