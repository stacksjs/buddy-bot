# Dependency Scanning

Buddy's dependency scanning engine is built on top of Bun's native dependency management tools and provides intelligent, fast, and accurate dependency analysis.

## How It Works

Buddy uses Bun's `outdated` command as its core scanning engine, which provides:

- **Native Performance**: Direct integration with Bun's C++ engine
- **Accurate Detection**: Uses lockfile analysis for precise version matching
- **Multi-Registry Support**: npm, JSR, and other registries
- **Package Manager Agnostic**: Works with npm, yarn, pnpm, and Bun

## Scanning Strategies

### Update Strategies

Configure how aggressively Buddy should scan for updates:

```typescript
// buddy-bot.config.ts
export default {
  packages: {
    strategy: 'patch', // 'major' | 'minor' | 'patch' | 'all'
  }
}
```

#### Strategy Types

- **`all`** (default): Scan for all available updates
- **`major`**: Only major version updates (1.x.x → 2.x.x)
- **`minor`**: Minor and patch updates (1.1.x → 1.2.x)
- **`patch`**: Only patch updates (1.1.1 → 1.1.2)

### Package Filtering

#### Ignore Packages

Skip specific packages from scanning:

```typescript
export default {
  packages: {
    ignore: [
      '@types/node',     // Specific package
      '@types/*',        // Glob patterns
      'react',           // Dependencies you want to control manually
    ]
  }
}
```

#### Pin Specific Versions

Lock packages to specific versions:

```typescript
export default {
  packages: {
    pin: {
      'typescript': '^5.0.0',  // Pin to major version
      'react': '18.2.0',       // Pin to exact version
    }
  }
}
```

## Package Groups

Organize related packages together for coordinated updates:

```typescript
export default {
  packages: {
    groups: [
      {
        name: 'React Ecosystem',
        packages: ['react', 'react-dom', '@types/react'],
        strategy: 'minor'
      },
      {
        name: 'Build Tools',
        packages: ['typescript', 'vite', 'rollup'],
        strategy: 'patch'
      }
    ]
  }
}
```

## CLI Commands

### Basic Scanning

```bash
# Scan all dependencies
buddy-bot scan

# Verbose output with detailed information
buddy-bot scan --verbose

# Scan with specific strategy
buddy-bot scan --strategy patch
```

### Targeted Scanning

```bash
# Scan specific packages only
buddy-bot scan --packages "react,typescript"

# Use glob patterns
buddy-bot scan --pattern "@types/*"

# Ignore specific packages during scan
buddy-bot scan --ignore "eslint,prettier"
```

### Check Specific Packages

```bash
# Check if specific packages have updates
buddy-bot check react typescript

# Check with specific strategy
buddy-bot check react --strategy minor
```

## Scan Results

Buddy provides detailed scan results with:

### Package Information
- Current version
- Latest available version
- Update type (major/minor/patch)
- Package metadata (description, homepage, license)

### Update Analysis
- **Security Updates**: Automatically detected security-related packages
- **Breaking Changes**: Major version updates flagged for review
- **Release Notes**: Automatically fetched from package registries

### Example Output

```bash
✓ Found 3 package updates

📦 React Ecosystem (2 updates)
  react: ^18.2.0 → ^18.3.1 (minor)
  @types/react: ^18.2.45 → ^18.3.1 (minor)

📦 Development Tools (1 update)
  typescript: ^5.3.3 → ^5.4.2 (minor)

🔒 Security: 0 packages
⚠️  Breaking: 0 packages
📈 Total: 3 packages ready for update
```

## Advanced Features

### Registry Integration

Buddy integrates with npm registry APIs to provide:

- Package existence validation
- Version history and changelog links
- Download statistics and popularity metrics
- Security vulnerability information

### Intelligent Filtering

- **Dependency Type Detection**: Separates prod, dev, peer, and optional dependencies
- **Monorepo Awareness**: Handles workspace dependencies correctly
- **Lock File Analysis**: Uses package-lock.json/bun.lockb for accurate versions

### Performance Optimization

- **Parallel Processing**: Scans multiple packages concurrently
- **Caching**: Intelligent caching of registry responses
- **Incremental Updates**: Only re-scans changed dependencies

## Configuration Examples

### Conservative Project

```typescript
export default {
  packages: {
    strategy: 'patch',
    ignore: ['react', 'vue', 'angular'], // Keep major frameworks stable
    groups: [
      {
        name: 'Security Updates',
        packages: ['helmet', 'cors', 'express-rate-limit'],
        strategy: 'all' // Always get security updates
      }
    ]
  }
}
```

### Aggressive Updates

```typescript
export default {
  packages: {
    strategy: 'all',
    ignore: ['@types/node'], // Only ignore Node.js types
    groups: [
      {
        name: 'Frontend',
        packages: ['react*', 'vue*', '@vue/*'],
        strategy: 'minor' // Allow minor updates for frontend
      }
    ]
  }
}
```

## Best Practices

1. **Start Conservative**: Begin with `patch` strategy and gradually increase
2. **Group Related Packages**: Keep ecosystems together (React, Vue, etc.)
3. **Review Major Updates**: Always review breaking changes manually
4. **Use Ignore Lists**: Skip packages you manage manually
5. **Monitor Security**: Enable all updates for security-related packages

## Troubleshooting

### Common Issues

**Scan finds no updates:**
- Check if packages are in ignore list
- Verify strategy allows the available update types
- Ensure package.json is readable

**Incorrect versions detected:**
- Update Bun to latest version
- Clear Bun cache: `bun install --force`
- Check for corrupted lockfiles

**Performance issues:**
- Reduce concurrent scans in large monorepos
- Use more specific package patterns
- Enable caching in CI environments
