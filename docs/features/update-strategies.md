# Update Strategies

Buddy provides flexible update strategies to control how dependencies are updated, allowing you to balance stability with staying current.

## Overview

Update strategies determine which package versions buddy will suggest for updates. You can configure global strategies or set specific strategies for package groups.

## Available Strategies

### `patch` - Safest Updates

Updates only patch versions (bug fixes and security updates).

```typescript
// Example: 1.2.3 → 1.2.4 (but not 1.3.0 or 2.0.0)
export default {
  packages: {
    strategy: 'patch'
  }
} satisfies BuddyBotConfig
```

**When to use:**
- Production applications requiring maximum stability
- Critical systems where breaking changes must be avoided
- Security-focused updates only

**Example updates:**
- `react@18.2.0` → `react@18.2.1` ✅
- `react@18.2.0` → `react@18.3.0` ❌
- `react@18.2.0` → `react@19.0.0` ❌

### `minor` - Balanced Updates

Updates patch and minor versions (new features, backwards compatible).

```typescript
// Example: 1.2.3 → 1.3.0 (but not 2.0.0)
export default {
  packages: {
    strategy: 'minor'
  }
} satisfies BuddyBotConfig
```

**When to use:**
- Most production applications
- Teams that want new features without breaking changes
- Gradual adoption of improvements

**Example updates:**
- `typescript@5.1.0` → `typescript@5.1.6` ✅ (patch)
- `typescript@5.1.0` → `typescript@5.2.0` ✅ (minor)
- `typescript@5.1.0` → `typescript@6.0.0` ❌ (major)

### `major` - Latest Stable

Updates to the latest stable version, including major versions with breaking changes.

```typescript
// Example: 1.2.3 → 2.0.0
export default {
  packages: {
    strategy: 'major'
  }
} satisfies BuddyBotConfig
```

**When to use:**
- Development environments
- Regular maintenance windows
- Teams comfortable with handling breaking changes

**Example updates:**
- `vue@2.7.0` → `vue@2.7.16` ✅ (patch)
- `vue@2.7.0` → `vue@3.4.0` ✅ (major)

### `all` - Most Aggressive

Updates to the absolute latest version available, including pre-releases when no stable version exists.

```typescript
export default {
  packages: {
    strategy: 'all'
  }
} satisfies BuddyBotConfig
```

**When to use:**
- Experimental projects
- Early adoption teams
- Testing latest features

**Example updates:**
- `next@14.0.0` → `next@15.0.0-rc.1` ✅ (pre-release)
- `react@18.2.0` → `react@19.0.0-beta.1` ✅ (beta)

## Strategy Configuration

### Global Strategy

Apply the same strategy to all packages:

```typescript
export default {
  packages: {
    strategy: 'minor', // Applied to all packages
    ignore: ['react'] // Except ignored packages
  }
} satisfies BuddyBotConfig
```

### Package Groups with Different Strategies

Use different strategies for different types of packages:

```typescript
export default {
  packages: {
    strategy: 'patch', // Default strategy
    groups: [
      {
        name: 'Core Framework',
        packages: ['react', 'react-dom', 'vue'],
        strategy: 'minor' // More conservative for core
      },
      {
        name: 'Development Tools',
        packages: ['eslint', 'prettier', 'typescript'],
        strategy: 'major' // More aggressive for dev tools
      },
      {
        name: 'Testing Libraries',
        packages: ['jest', 'vitest', '@testing-library/*'],
        strategy: 'minor'
      }
    ]
  }
} satisfies BuddyBotConfig
```

### Per-Package Strategy Override

Override strategy for specific packages:

```typescript
export default {
  packages: {
    strategy: 'minor',
    overrides: {
      'react': 'patch', // Keep React very stable
      'typescript': 'major', // Always get latest TypeScript
      '@types/*': 'all' // Type definitions can be aggressive
    }
  }
} satisfies BuddyBotConfig
```

## Smart Strategy Selection

Buddy automatically adjusts strategies based on package characteristics:

### Security Updates

Security patches are always prioritized regardless of strategy:

```typescript
// Even with strategy: 'patch', security updates may include minor versions
const securityConfig = {
  strategy: 'patch',
  securityUpdates: {
    priority: 'high', // Override strategy for security
    autoApply: true, // Automatically apply security updates
    minSeverity: 'moderate' // Minimum severity to trigger
  }
}
```

### Breaking Change Detection

Buddy analyzes changelogs and release notes to detect breaking changes:

```typescript
const breakingConfig = {
  packages: {
    strategy: 'major',
    breakingChangeHandling: {
      requireApproval: true, // Require manual approval for breaking changes
      skipBeta: true, // Skip beta versions with breaking changes
      maxMajorJump: 1 // Only allow 1 major version jump at a time
    }
  }
}
```

## Strategy Best Practices

### Progressive Strategy

Start conservative and gradually increase aggressiveness:

```typescript
// Week 1: Patch only
const week1Config = { strategy: 'patch' }

// Week 2: Add minor updates
const week2Config = { strategy: 'minor' }

// Week 3: Add major updates for dev dependencies
const week3Config = {
  strategy: 'minor',
  groups: [
    {
      name: 'Development',
      packages: ['eslint', 'prettier', 'webpack'],
      strategy: 'major'
    }
  ]
}
```

### Environment-Specific Strategies

Different strategies for different environments:

```typescript
const isProduction = process.env.NODE_ENV === 'production'
const isCorporate = process.env.CORPORATE_ENVIRONMENT === 'true'

export default {
  packages: {
    strategy: isProduction
      ? (isCorporate ? 'patch' : 'minor')
      : 'major'
  }
} satisfies BuddyBotConfig
```

### Ecosystem-Aware Strategies

Tailor strategies to specific ecosystems:

```typescript
const config = {
  packages: {
    strategy: 'minor',
    groups: [
      {
        name: 'React Ecosystem',
        packages: ['react*', '@react*'],
        strategy: 'minor' // React ecosystem moves together
      },
      {
        name: 'Node Types',
        packages: ['@types/node'],
        strategy: 'patch' // Node types should match Node version
      },
      {
        name: 'Build Tools',
        packages: ['vite', 'rollup', 'esbuild'],
        strategy: 'major' // Build tools are less breaking
      }
    ]
  }
}
```

## CLI Strategy Overrides

Override configuration strategies via CLI:

```bash
# Force patch strategy regardless of config
buddy-bot update --strategy patch

# Use major strategy for specific packages
buddy-bot update --strategy major --packages react,vue

# Mixed strategies
buddy-bot update --patch typescript --minor react --major eslint
```

## Monitoring Strategy Effectiveness

Track how strategies perform:

```typescript
const monitoringConfig = {
  packages: {
    strategy: 'minor',
    monitoring: {
      trackFailures: true, // Track failed updates
      rollbackThreshold: 3, // Auto-rollback after 3 failures
      successRate: 0.95, // Require 95% success rate
      adaptStrategy: true // Auto-adjust strategy based on success
    }
  }
}
```

## Common Strategy Patterns

### Conservative Enterprise

```typescript
export default {
  packages: {
    strategy: 'patch',
    securityUpdates: { autoApply: true },
    groups: [
      {
        name: 'Development Only',
        packages: ['@types/*', 'eslint*', 'prettier'],
        strategy: 'minor'
      }
    ]
  }
} satisfies BuddyBotConfig
```

### Balanced Team

```typescript
export default {
  packages: {
    strategy: 'minor',
    groups: [
      {
        name: 'Core Dependencies',
        packages: ['react', 'vue', 'angular'],
        strategy: 'patch'
      },
      {
        name: 'Development Tools',
        packages: ['typescript', 'webpack', 'vite'],
        strategy: 'major'
      }
    ]
  }
} satisfies BuddyBotConfig
```

### Aggressive Startup

```typescript
export default {
  packages: {
    strategy: 'major',
    groups: [
      {
        name: 'Database & Infrastructure',
        packages: ['prisma', 'mongoose', 'redis'],
        strategy: 'minor' // More careful with data layers
      }
    ]
  }
} satisfies BuddyBotConfig
```

## Integration with Pull Requests

Strategies affect PR creation:

- **Patch updates**: Auto-mergeable, minimal review
- **Minor updates**: Standard review process
- **Major updates**: Require explicit approval, additional testing
- **Security updates**: High priority, expedited merge

See [Pull Request Generation](/features/pull-requests) for more details on how strategies influence PR behavior.
