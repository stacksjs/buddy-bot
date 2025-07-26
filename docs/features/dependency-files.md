# Dependency Files Support

Buddy provides comprehensive support for multiple dependency file formats beyond traditional `package.json` files, including pkgx and Launchpad dependency files.

## Supported File Formats

Buddy automatically detects and updates the following dependency file formats:

### Traditional Package Files
- **package.json** - npm, yarn, pnpm, and Bun dependencies

### pkgx and Launchpad Dependency Files
- **deps.yaml** / **deps.yml** - Main dependency format used by pkgx and Launchpad
- **dependencies.yaml** / **dependencies.yml** - Alternative dependency file naming
- **pkgx.yaml** / **pkgx.yml** - pkgx-specific dependency files
- **.deps.yaml** / **.deps.yml** - Hidden dependency configuration files

## How It Works

Buddy uses the `ts-pkgx` library to parse and resolve dependency files, ensuring full compatibility with the pkgx registry ecosystem while supporting tools like Launchpad that reuse the same registry format.

### Automatic Detection

```bash
# Buddy automatically scans for these files:
my-project/
├── package.json              # ✅ npm dependencies
├── deps.yaml                 # ✅ Launchpad/pkgx dependencies
├── dependencies.yml          # ✅ Alternative format
├── .deps.yaml               # ✅ Hidden config
├── frontend/
│   ├── package.json         # ✅ Frontend npm deps
│   └── pkgx.yml            # ✅ Frontend tooling
└── backend/
    ├── package.json         # ✅ Backend npm deps
    └── deps.yaml           # ✅ Backend tools
```

### Registry Integration

All dependency files are resolved through the pkgx registry, providing access to:

- **Cross-platform packages** - Works on macOS, Linux, and Windows
- **Version management** - Semantic versioning with intelligent resolution
- **Package ecosystems** - Node.js, Python, Go, Rust, and more
- **Build tools** - Compilers, linters, formatters, and development tools

## File Format Examples

### Basic Dependency File

```yaml
# deps.yaml
dependencies:
  node: ^20.0.0
  typescript: ^5.0.0
  bun: ^1.0.0

devDependencies:
  eslint: ^8.0.0
  prettier: ^3.0.0
```

### Complex Configuration

```yaml
# dependencies.yaml
dependencies:
  # Runtime dependencies
  node: ^20.0.0
  python: ~3.11.0

  # Package managers
  npm: ^10.0.0
  pip: latest

  # Development tools
  git: ^2.40.0

devDependencies:
  # Linting and formatting
  eslint: ^8.0.0
  prettier: ^3.0.0
  black: ^23.0.0

  # Testing
  jest: ^29.0.0
  pytest: ^7.0.0

# Optional dependencies for specific environments
optionalDependencies:
  docker: ^24.0.0
  kubernetes: ^1.28.0
```

### Hidden Configuration

```yaml
# .deps.yaml - Hidden configuration file
dependencies:
  # System-level dependencies
  curl: ^8.0.0
  jq: ^1.6.0

  # CI/CD tools
  gh: ^2.0.0
  act: ^0.2.0
```

## Version Constraints

Buddy preserves your version constraints when updating dependency files:

### Supported Constraint Types

```yaml
dependencies:
  # Caret range (compatible updates)
  typescript: ^5.0.0 # >=5.0.0 <6.0.0

  # Tilde range (patch updates)
  eslint: ~8.45.0 # >=8.45.0 <8.46.0

  # Greater than or equal
  node: '>=20.0.0' # Any version >= 20.0.0

  # Exact version
  python: 3.11.5 # Exactly 3.11.5

  # Latest version
  bun: latest # Always the latest

  # Version ranges
  go: '>=1.20.0 <1.22.0' # Between versions
```

### Update Preservation

```yaml
# Before update
dependencies:
  express: ^4.18.0 # Caret range
  lodash: ~4.17.20 # Tilde range
  react: '>=18.0.0' # Greater than or equal
  vue: 3.0.0 # Exact version

# After update (constraints preserved)
# dependencies:
#   express: ^4.18.2    # Caret preserved
#   lodash: ~4.17.21    # Tilde preserved
#   react: ">=18.2.0"   # Range preserved
#   vue: 3.0.5          # Exact updated
```

## Configuration

### Global Settings

```typescript
// buddy-bot.config.ts
export default {
  packages: {
    strategy: 'patch', // Apply to all file types

    // Ignore specific packages across all files
    ignore: [
      'node', // Keep Node.js version stable
      'python' // Manage Python version manually
    ],

    // Package groups work across file types
    groups: [
      {
        name: 'Development Tools',
        packages: ['eslint', 'prettier', 'typescript'],
        strategy: 'minor'
      },
      {
        name: 'Runtime Dependencies',
        packages: ['node', 'python', 'bun'],
        strategy: 'patch' // Conservative for runtimes
      }
    ]
  }
} satisfies BuddyBotConfig
```

### File-Specific Configuration

```typescript
export default {
  packages: {
    // Different strategies for different file types
    fileStrategies: {
      'package.json': 'minor', // npm packages
      'deps.yaml': 'patch', // Launchpad/pkgx tools
      '.deps.yaml': 'all' // Hidden config files
    }
  }
} satisfies BuddyBotConfig
```

## Pull Request Integration

### Mixed File Updates

When Buddy finds updates across multiple file types, it creates coordinated pull requests:

```markdown
# Example PR: Update development dependencies

This PR updates dependencies across multiple formats:

## Package.json Updates
| Package | From | To | Type |
|---------|------|----|----- |
| typescript | ^5.0.0 | ^5.1.0 | devDependencies |
| eslint | ^8.45.0 | ^8.46.0 | devDependencies |

## Dependency Files Updates
| Package | From | To | File |
|---------|------|----|----- |
| prettier | ^3.0.0 | ^3.0.1 | deps.yaml |
| bun | ^1.0.0 | ^1.0.5 | .deps.yaml |

## Changes Summary
- 2 package.json updates (development dependencies)
- 2 dependency file updates (tooling and runtime)
- All updates are backward compatible
```

### Separate PRs Option

Configure separate PRs for different file types:

```typescript
export default {
  pullRequest: {
    groupByFileType: true, // Create separate PRs per file type

    // Custom PR titles
    titleFormat: {
      'package.json': 'chore(deps): update npm dependencies',
      'deps.yaml': 'chore(tools): update pkgx dependencies',
      'default': 'chore(deps): update {fileType} dependencies'
    }
  }
} satisfies BuddyBotConfig
```

## Monorepo Support

Buddy handles monorepos with mixed dependency file formats:

```bash
monorepo/
├── package.json                 # Root dependencies
├── deps.yaml                   # Global tools
├── packages/
│   ├── frontend/
│   │   ├── package.json        # Frontend npm deps
│   │   └── deps.yml           # Frontend tools
│   ├── backend/
│   │   ├── package.json        # Backend npm deps
│   │   └── dependencies.yaml   # Backend services
│   └── shared/
│       ├── package.json        # Shared npm deps
│       └── .deps.yaml         # Shared tooling
└── tools/
    ├── build/
    │   └── pkgx.yaml          # Build tools
    └── deploy/
        └── deps.yaml          # Deployment tools
```

### Monorepo Configuration

```typescript
export default {
  packages: {
    workspaces: [
      'packages/*/package.json',
      'packages/*/deps.{yaml,yml}',
      'tools/*/deps.yaml'
    ],

    groups: [
      {
        name: 'Frontend Dependencies',
        packages: ['react', 'typescript', 'vite'],
        workspaces: ['packages/frontend/**']
      },
      {
        name: 'Build Tools',
        packages: ['esbuild', 'rollup', 'webpack'],
        workspaces: ['tools/build/**']
      }
    ]
  }
} satisfies BuddyBotConfig
```

## CLI Commands

### Scan Specific File Types

```bash
# Scan only package.json files
buddy-bot scan --file-type package.json

# Scan only dependency files
buddy-bot scan --file-type deps.yaml

# Scan specific files
buddy-bot scan --files "deps.yaml,package.json"
```

### Update Specific Formats

```bash
# Update only npm dependencies
buddy-bot update --package-manager npm

# Update only pkgx dependencies
buddy-bot update --package-manager pkgx

# Update with different strategies per type
buddy-bot update --strategy package.json:minor,deps.yaml:patch
```

## Troubleshooting

### Common Issues

**Dependency file not detected:**
```bash
# Verify file format and naming
ls -la deps.yaml deps.yml dependencies.yaml

# Check file content format
cat deps.yaml
```

**pkgx resolution errors:**
```bash
# Verify ts-pkgx can parse the file
bunx ts-pkgx resolve deps.yaml

# Check for syntax errors
yamllint deps.yaml
```

**Mixed version constraints:**
```bash
# Use consistent constraint formats
# ✅ Good: ^1.0.0, ~2.1.0, >=3.0.0
# ❌ Avoid: 1.*, ^1.0, ~2
```

### Debug Mode

```bash
# Enable verbose logging for dependency files
buddy-bot scan --verbose --debug dependency-files

# Show file detection process
buddy-bot scan --show-files
```

## Best Practices

### File Organization

1. **Use consistent naming** - Prefer `deps.yaml` for main dependency files
2. **Separate concerns** - Use different files for different purposes
3. **Version consistency** - Use the same constraint format across files
4. **Documentation** - Comment your dependency files

### Version Management

1. **Conservative constraints** - Use tilde (`~`) for stable dependencies
2. **Development flexibility** - Use caret (`^`) for development tools
3. **Runtime stability** - Pin exact versions for critical runtime dependencies
4. **Regular updates** - Use Buddy's scheduling for consistent maintenance

### Security

1. **Review updates** - Don't auto-merge major version updates
2. **Test compatibility** - Verify updates in development environments
3. **Monitor advisories** - Enable security-focused update strategies
4. **Audit regularly** - Use security scanning tools alongside Buddy
