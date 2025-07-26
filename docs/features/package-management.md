# Package Management

Buddy provides comprehensive package management capabilities, from discovery and analysis to intelligent updating and conflict resolution.

## Package Discovery

Buddy automatically discovers packages across your project structure using Bun's native package management capabilities.

### Supported Package Managers

Buddy works with multiple package managers and dependency file formats:

- **Bun** - Lightning-fast native support
- **npm** - Full compatibility with npm ecosystem
- **yarn** - Classic and Berry versions
- **pnpm** - Efficient disk usage and fast installs
- **pkgx** - Cross-platform package manager with YAML dependency files
- **Launchpad** - Fast package manager using pkgx registry format
- **GitHub Actions** - Workflow dependency automation

### Dependency File Formats

Buddy automatically detects and updates various dependency file formats:

#### Package Dependencies
```yaml
# deps.yaml / deps.yml - pkgx and Launchpad
dependencies:
  node: ^20.0.0
  typescript: ^5.0.0

devDependencies:
  eslint: ^8.0.0

# dependencies.yaml / dependencies.yml - Alternative format
# dependencies:
#   react: ^18.0.0
#   lodash: ^4.17.21

# pkgx.yaml / pkgx.yml - pkgx-specific
# dependencies:
#   python: ~3.11.0
#   poetry: ^1.6.0

# .deps.yaml / .deps.yml - Hidden configuration
# dependencies:
#   bun: latest
```

#### GitHub Actions
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # ← Automatically updated
      - uses: oven-sh/setup-bun@v2 # ← Automatically updated
      - uses: actions/cache@v4.1.0 # ← Automatically updated
      - name: Install dependencies
        run: bun install
      - name: Run tests
        run: bun test
```

All dependency files are parsed using the `ts-pkgx` library to ensure compatibility with the pkgx registry ecosystem. GitHub Actions are detected by parsing `uses:` statements in workflow files and checking for updates via the GitHub releases API.

### Project Structure Detection

```typescript
// Automatically detected files
const packageStructure = {
  packageFiles: [
    'package.json', // Root npm dependencies
    'deps.yaml', // Launchpad/pkgx dependencies
    'deps.yml', // Alternative extension
    'dependencies.yaml', // Alternative format
    'pkgx.yaml', // pkgx-specific
    '.deps.yaml', // Hidden config
    'apps/*/package.json', // Monorepo apps
    'packages/*/package.json', // Monorepo packages
    'tools/*/package.json' // Tool packages
  ]
}
```

### Configuration

```typescript
export default {
  packages: {
    // Package manager preference
    manager: 'bun', // 'bun' | 'npm' | 'yarn' | 'pnpm'

    // Discovery patterns
    include: [
      'package.json',
      'apps/*/package.json',
      'packages/*/package.json'
    ],

    // Exclude patterns
    exclude: [
      'node_modules/**/package.json',
      'dist/**/package.json',
      'build/**/package.json'
    ]
  }
} satisfies BuddyBotConfig
```

## Package Analysis

Buddy provides detailed package analysis and information retrieval.

### Package Information

```bash
# Get detailed package information
buddy-bot info react

# Check if package exists
buddy-bot exists @types/unknown-package

# Get all available versions
buddy-bot versions typescript

# Get latest version only
buddy-bot latest vue
```

### Dependency Analysis

```bash
# Show package dependencies
buddy-bot deps react

# Compare versions
buddy-bot compare react 17.0.0 18.0.0

# Search for packages
buddy-bot search "state management"
```

### Registry Integration

Buddy integrates with multiple package registries:

```typescript
const registryIntegration = {
  registries: {
    npm: 'https://registry.npmjs.org',
    github: 'https://npm.pkg.github.com',
    private: 'https://registry.company.com'
  },
  authentication: {
    github: process.env.GITHUB_TOKEN,
    private: process.env.PRIVATE_REGISTRY_TOKEN
  }
}
```

## Package Filtering

Control which packages are managed by buddy.

### Ignore Patterns

```typescript
export default {
  packages: {
    // Global ignore list
    ignore: [
      '@types/node', // Keep Node types stable
      'react', // Manual React updates
      'vue', // Manual Vue updates
      '@internal/*', // Internal packages
      'workspace:*' // Workspace packages
    ],

    // Ignore by pattern
    ignorePatterns: [
      '**/@types/**', // All type definitions
      '**/eslint-*', // All ESLint packages
      'babel-*' // All Babel packages
    ]
  }
} satisfies BuddyBotConfig
```

### Include/Exclude by Scope

```typescript
const scopeConfig = {
  packages: {
    // Only manage specific scopes
    includeScopes: ['@company', '@internal'],

    // Exclude specific scopes
    excludeScopes: ['@types', '@babel'],

    // Include/exclude by keywords
    includeKeywords: ['typescript', 'testing'],
    excludeKeywords: ['deprecated', 'beta']
  }
}
```

## Package Grouping

Organize related packages for coordinated updates.

### Ecosystem Groups

```typescript
export default {
  packages: {
    groups: [
      {
        name: 'React Ecosystem',
        packages: ['react', 'react-dom', '@types/react', '@types/react-dom'],
        strategy: 'minor',
        description: 'Core React framework and types'
      },
      {
        name: 'Testing Framework',
        packages: ['jest', '@types/jest', 'jest-environment-jsdom'],
        strategy: 'patch',
        autoMerge: true
      },
      {
        name: 'Build Tools',
        packages: ['webpack', 'webpack-cli', 'webpack-dev-server'],
        strategy: 'major',
        reviewers: ['build-team']
      }
    ]
  }
} satisfies BuddyBotConfig
```

### Pattern-Based Groups

```typescript
const patternGroupsConfig = {
  packages: {
    groups: [
      {
        name: 'Type Definitions',
        pattern: '@types/*',
        strategy: 'minor',
        autoMerge: true
      },
      {
        name: 'ESLint Ecosystem',
        pattern: 'eslint*',
        strategy: 'patch'
      },
      {
        name: 'Babel Plugins',
        pattern: 'babel-*',
        strategy: 'minor'
      }
    ]
  }
}
```

## Version Management

Sophisticated version handling and constraint management.

### Version Constraints

```typescript
export default {
  packages: {
    // Pin specific packages
    pin: {
      react: '^18.0.0', // Pin to React 18.x
      node: '>=18.0.0', // Minimum Node version
      typescript: '~5.0.0' // Pin to TypeScript 5.0.x
    },

    // Version ranges
    ranges: {
      'vue': '^3.0.0', // Vue 3.x only
      '@angular/core': '^16.0.0 || ^17.0.0' // Multiple ranges
    }
  }
} satisfies BuddyBotConfig
```

### Version Prefix Preservation

Buddy preserves original version prefixes:

```javascript
// Before update
const beforeUpdate = {
  dependencies: {
    react: '18.2.0', // No prefix
    vue: '^3.3.0', // Caret prefix
    lodash: '~4.17.0' // Tilde prefix
  }
}

// After update (prefixes preserved)
const afterUpdate = {
  dependencies: {
    react: '18.2.1', // Still no prefix
    vue: '^3.4.0', // Caret preserved
    lodash: '~4.17.21' // Tilde preserved
  }
}
```

### Custom Version Resolution

```typescript
const customResolversConfig = {
  packages: {
    customResolvers: {
      'react': (current, available) => {
        // Custom logic for React versions
        return available.filter(v => v.major === 18).pop()
      },
      '@types/*': (current, available) => {
        // Always get latest types
        return available[available.length - 1]
      }
    }
  }
}
```

## Monorepo Support

Advanced support for monorepo package management.

### Workspace Detection

```typescript
export default {
  packages: {
    workspaces: {
      // Auto-detect workspaces
      autoDetect: true,

      // Manual workspace patterns
      patterns: [
        'packages/*',
        'apps/*',
        'tools/*'
      ],

      // Workspace-specific configuration
      configs: {
        'packages/ui': {
          strategy: 'patch',
          autoMerge: true
        },
        'apps/web': {
          strategy: 'minor',
          reviewers: ['frontend-team']
        }
      }
    }
  }
} satisfies BuddyBotConfig
```

### Cross-Workspace Dependencies

```typescript
const workspaceConfig = {
  packages: {
    workspaces: {
      // Handle internal dependencies
      internalDeps: {
        strategy: 'workspace', // Use workspace protocol
        autoUpdate: true, // Update internal refs
        linkLocal: true // Link local packages
      },

      // Shared dependencies
      sharedDeps: {
        hoist: true, // Hoist common dependencies
        dedupe: true, // Remove duplicates
        align: true // Align versions across workspaces
      }
    }
  }
}
```

## Performance Optimization

Optimize package management for speed and efficiency.

### Caching

```typescript
const cacheConfig = {
  packages: {
    cache: {
      enabled: true,
      ttl: 3600, // Cache for 1 hour
      strategy: 'memory', // 'memory' | 'disk' | 'redis'

      // Cache invalidation
      invalidateOn: [
        'package.json.change',
        'lockfile.change',
        'registry.change'
      ]
    }
  }
}
```

### Parallel Processing

```typescript
const parallelConfig = {
  packages: {
    parallel: {
      enabled: true,
      maxConcurrency: 10, // Max parallel requests
      batchSize: 50, // Packages per batch

      // Rate limiting
      rateLimit: {
        requests: 100, // Requests per period
        period: 60000 // Period in ms (1 minute)
      }
    }
  }
}
```

### Registry Optimization

```typescript
const registryConfig = {
  packages: {
    registries: {
      // Primary registry
      primary: 'https://registry.npmjs.org',

      // Fallback registries
      fallbacks: [
        'https://registry.yarnpkg.com',
        'https://packages.ow3.org'
      ],

      // Registry-specific caching
      cache: {
        'https://registry.npmjs.org': {
          ttl: 3600,
          compress: true
        }
      }
    }
  }
}
```

## Security Features

Package security scanning and vulnerability management.

### Vulnerability Scanning

```typescript
const securityConfig = {
  packages: {
    security: {
      enabled: true,

      // Vulnerability databases
      sources: [
        'npm-audit',
        'github-advisories',
        'snyk'
      ],

      // Severity thresholds
      thresholds: {
        critical: 'block', // Block critical vulnerabilities
        high: 'warn', // Warn on high severity
        moderate: 'info', // Info for moderate
        low: 'ignore' // Ignore low severity
      }
    }
  }
}
```

### License Compliance

```typescript
const licenseConfig = {
  packages: {
    licenses: {
      // Allowed licenses
      allowed: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],

      // Blocked licenses
      blocked: ['GPL-3.0', 'AGPL-3.0'],

      // License checking
      check: {
        enabled: true,
        failOnViolation: true,
        reportPath: './license-report.json'
      }
    }
  }
}
```

## CLI Integration

All package management features are available via CLI.

### Package Commands

```bash
# Check package updates
buddy-bot check react vue typescript

# Get package information
buddy-bot info @types/node --detailed

# Search packages
buddy-bot search "ui component" --limit 10

# Analyze dependencies
buddy-bot deps react --depth 2
```

### Batch Operations

```bash
# Update multiple packages
buddy-bot update --packages react,vue,typescript

# Update by pattern
buddy-bot update --pattern "@types/*"

# Update by group
buddy-bot update --group "React Ecosystem"
```

See [CLI Package Commands](/cli/package) for complete CLI reference.
