# Ecosystems

Buddy Bot updates dependencies across npm/Bun/yarn/pnpm, Composer, GitHub
Actions, Docker, pkgx/Launchpad, Zig, and — through the adapter interface —
Python, Rust, Go and Ruby.

## Adapter-backed ecosystems

| Ecosystem | Manifests                                       | Registry            | Lockfile             |
| --------- | ----------------------------------------------- | ------------------- | -------------------- |
| Python    | `pyproject.toml`, `requirements*.txt`           | PyPI                | `uv.lock`, `poetry.lock` |
| Rust      | `Cargo.toml` (incl. workspace deps)             | crates.io           | `Cargo.lock`         |
| Go        | `go.mod`                                        | Go module proxy     | `go.sum`             |
| Ruby      | `Gemfile`, `*.gemspec`                          | RubyGems            | `Gemfile.lock`       |

All four are indexed by OSV, so advisories are reported for them alongside npm
and Composer.

### What is deliberately left alone

Each adapter declines to touch things that look like dependencies but are not
a version bump:

- **Python** — `-r`, `-e` and `--index-url` directives; requirements with no
  constraint; Poetry's `python` interpreter marker; yanked releases.
- **Rust** — `path` and `git` dependencies, which have no registry version;
  yanked crates.
- **Go** — `// indirect` requirements, which are `go mod tidy`'s job;
  pseudo-versions like `v0.0.0-20230101120000-abcdef12`, which name an
  untagged commit rather than a release. A v1→v2 upgrade changes the module
  *path*, which is a source change rather than a dependency bump, so it is not
  proposed.
- **Ruby** — commented-out gems; gems with `path:`, `git:` or `github:`; gems
  with no constraint, which bundler already resolves freely.

### Version comparison

Python uses PEP 440, not semver, and the difference is not cosmetic:
`1.0.post1` is **newer** than `1.0`, a `.dev` release precedes everything at
the same version number, and an epoch (`1!2.0`) outranks any release number.
Comparing Python versions as semver would propose a downgrade for every
post-release on PyPI.

Rust, Go and Ruby order numerically, component by component.

### Constraint operators are preserved

An update never rewrites the *kind* of constraint a maintainer chose:

```text
requests~=2.28.0   →  requests~=2.31.0     (not ==2.31.0)
gem 'rails', '~> 7.0.4'  →  gem 'rails', '~> 7.1.0'
serde = "1.0.190"  →  serde = "1.0.200"
```

`~=` and `~>` are compatible-release policies. Replacing either with an exact
version turns a deliberately flexible constraint into a pin, which is a change
nobody asked for arriving inside a dependency update.

### Lockfiles

Regeneration is best-effort. If `cargo`, `go`, `uv`, `poetry` or `bundle` is
not installed on the runner, the pull request is still opened and says which
lockfile needs regenerating locally. Producing no pull request because a
toolchain is missing would hide the update entirely, which is worse than an
incomplete one that says so.

## Targeting an ecosystem with rules

```typescript
rules: [
  { matchEcosystems: ['python'], reviewers: ['data-team'] },
  { matchEcosystems: ['rust', 'go'], matchUpdateTypes: ['major'], enabled: false },
]
```

## Adding an ecosystem

Implement `EcosystemAdapter` in `src/ecosystems/<name>.ts` and register it in
`BUILTIN_ADAPTERS`. The interface is:

```typescript
interface EcosystemAdapter {
  name: string
  manifestPatterns: string[]
  detect: (dir: string) => Promise<string[]>
  parse: (file: string, content: string) => Promise<EcosystemDependency[]>
  latest: (dep: EcosystemDependency, opts?: LatestOptions) => Promise<VersionInfo | null>
  applyUpdate: (content: string, update: EcosystemUpdate) => string
  postWrite?: (dir: string) => Promise<{ regenerated: string[], note?: string }>
  osvEcosystem?: string
  compareVersions: (a: string, b: string) => number
  updateType: (from: string, to: string) => 'major' | 'minor' | 'patch'
}
```

Three rules worth following, each learned from a bug:

1. **`applyUpdate` must return the content unchanged when nothing matched.**
   A failed match has to be a no-op, not a corrupted file — the scanner warns
   when a write produced no change rather than committing it.

2. **Parse with regexes, not a parse/serialize round-trip.** The write path
   has to preserve the maintainer's exact formatting, and re-serializing a
   parsed document loses comments, key order and whitespace.

3. **`compareVersions` belongs to the ecosystem.** Sharing one comparator is
   how a Python post-release gets proposed as a downgrade.

`src/ecosystems/shared.ts` has `detectFiles` (depth-limited, skipping
`node_modules`, `target`, `vendor` and friends — those manifests belong to
dependencies, and proposing updates for them is proposing to edit vendored
code) and `regenerateWith` for lockfiles.
