# Monorepo Support

Buddy provides comprehensive support for monorepo dependency management with intelligent workspace detection and coordinated updates.

## Workspace Detection

Automatically detect and manage dependencies across monorepo workspaces.

### Auto-Detection

```typescript
export default {
  packages: {
    workspaces: {
      // Enable automatic workspace detection
      autoDetect: true,

      // Supported workspace configurations
      patterns: [
        'packages/*',
        'apps/*',
        'tools/*',
        'libs/*'
      ]
    }
  }
} satisfies BuddyBotConfig
```

### Manual Configuration

```typescript
{
  packages: {
    workspaces: {
      // Explicit workspace definitions
      workspaces: [
        {
          name: 'frontend-apps',
          path: 'apps/frontend/*',
          packageManager: 'bun'
        },
        {
          name: 'backend-services',
          path: 'services/*',
          packageManager: 'bun'
        },
        {
          name: 'shared-libraries',
          path: 'packages/*',
          packageManager: 'bun'
        }
      ]
    }
  }
}
```

## Workspace-Specific Configuration

Tailor dependency management for different workspace types:

```typescript
const workspaceSpecificConfig = {
  packages: {
    workspaces: {
      configs: {
        'packages/ui': {
          strategy: 'patch', // Conservative for UI components
          autoMerge: true,
          labels: ['ui', 'safe'],
          reviewers: ['ui-team']
        },
        'apps/web': {
          strategy: 'minor', // More aggressive for apps
          reviewers: ['frontend-team'],
          testing: {
            e2e: true, // Run E2E tests
            lighthouse: true // Performance testing
          }
        },
        'services/api': {
          strategy: 'patch', // Conservative for backend
          reviewers: ['backend-team', 'devops-team'],
          testing: {
            integration: true,
            loadTesting: true
          }
        },
        'packages/utils': {
          strategy: 'minor',
          cascade: true, // Trigger dependent updates
          downstream: ['packages/ui', 'apps/*']
        }
      }
    }
  }
}
```

## Dependency Coordination

Coordinate updates across workspaces for shared dependencies.

### Shared Dependency Alignment

```typescript
const sharedDependencyAlignment = {
  packages: {
    workspaces: {
      coordination: {
        // Align shared dependencies
        alignSharedDeps: true,

        // Shared dependency groups
        sharedGroups: {
          'react-ecosystem': {
            packages: ['react', 'react-dom', '@types/react'],
            strategy: 'minor',
            synchronized: true
          },
          'testing-tools': {
            packages: ['jest', 'vitest', '@testing-library/*'],
            strategy: 'patch',
            synchronized: true
          },
          'build-tools': {
            packages: ['typescript', 'vite', 'rollup'],
            strategy: 'minor',
            synchronized: false
          }
        }
      }
    }
  }
}
```

### Cross-Workspace Dependencies

```typescript
const crossWorkspaceDeps = {
  packages: {
    workspaces: {
      internalDeps: {
        // Handle workspace protocol
        useWorkspaceProtocol: true,

        // Update internal references
        updateInternalRefs: true,

        // Version synchronization
        syncVersions: {
          enabled: true,
          strategy: 'exact', // 'exact' | 'range' | 'workspace'
          bumpTogether: true
        }
      }
    }
  }
}
```

## Update Orchestration

Coordinate updates across multiple workspaces intelligently.

### Update Ordering

```typescript
const updateOrderingConfig = {
  packages: {
    workspaces: {
      updateOrder: {
        // Define dependency order
        order: [
          'packages/utils', // Base utilities first
          'packages/ui', // UI components next
          'apps/*', // Applications last
          'services/*' // Services in parallel
        ],

        // Parallel execution groups
        parallelGroups: [
          ['apps/web', 'apps/mobile'],
          ['services/api', 'services/worker', 'services/auth']
        ]
      }
    }
  }
}
```

### Cascade Updates

```typescript
const cascadeUpdatesConfig = {
  packages: {
    workspaces: {
      cascade: {
        enabled: true,

        // Trigger downstream updates
        triggers: {
          'packages/ui': ['apps/web', 'apps/mobile'],
          'packages/utils': ['packages/ui', 'services/*'],
          'packages/types': ['**/*'] // Update all workspaces
        },

        // Cascade delays
        delays: {
          'packages/ui': 300, // 5 minute delay
          'packages/utils': 600 // 10 minute delay
        }
      }
    }
  }
}
```

## Monorepo Patterns

Support common monorepo patterns and tools.

### Nx Support

```typescript
const nxSupportConfig = {
  packages: {
    monorepo: {
      tool: 'nx',

      // Nx-specific configuration
      nx: {
        projectGraph: true,
        affectedProjects: true,
        buildTargets: ['build', 'test', 'lint'],

        // Update affected projects only
        updateStrategy: 'affected',
        baseBranch: 'main'
      }
    }
  }
}
```

### Lerna Support

```typescript
const lernaSupportConfig = {
  packages: {
    monorepo: {
      tool: 'lerna',

      // Lerna-specific configuration
      lerna: {
        version: 'independent',
        conventionalCommits: true,
        changelog: true,

        // Package discovery
        packages: ['packages/*', 'apps/*'],
        ignoreChanges: ['*.md', '*.test.js']
      }
    }
  }
}
```

### Rush Support

```typescript
const rushSupportConfig = {
  packages: {
    monorepo: {
      tool: 'rush',

      // Rush-specific configuration
      rush: {
        rushJson: 'rush.json',
        variants: ['dev', 'prod'],

        // Bulk operations
        bulkCommands: {
          build: 'rush rebuild',
          test: 'rush test',
          lint: 'rush lint'
        }
      }
    }
  }
}
```

## Testing & Validation

Comprehensive testing for monorepo updates.

### Cross-Workspace Testing

```typescript
const crossWorkspaceTestingConfig = {
  packages: {
    workspaces: {
      testing: {
        // Run tests in dependency order
        testInOrder: true,

        // Cross-workspace integration tests
        integrationTests: {
          enabled: true,
          testSuites: [
            {
              name: 'ui-apps-integration',
              workspaces: ['packages/ui', 'apps/web'],
              command: 'bun test:integration'
            }
          ]
        },

        // Regression testing
        regressionTests: {
          enabled: true,
          baseline: 'main',
          affectedOnly: true
        }
      }
    }
  }
}
```

### Build Validation

```typescript
const buildValidationConfig = {
  packages: {
    workspaces: {
      validation: {
        // Validate builds across workspaces
        buildValidation: {
          enabled: true,
          parallel: true,
          maxConcurrency: 4
        },

        // Type checking
        typeChecking: {
          enabled: true,
          incremental: true,
          projectReferences: true
        },

        // Dependency validation
        dependencyChecks: {
          circular: true,
          unused: true,
          mismatched: true
        }
      }
    }
  }
}
```

## Performance Optimization

Optimize dependency management for large monorepos.

### Caching Strategy

```typescript
const cachingStrategyConfig = {
  packages: {
    workspaces: {
      performance: {
        // Multi-level caching
        caching: {
          enabled: true,
          levels: ['memory', 'disk', 'remote'],

          // Cache keys
          keyStrategy: 'workspace-hash',
          invalidation: 'dependency-change'
        },

        // Parallel processing
        parallel: {
          enabled: true,
          maxWorkers: 8,
          workspaceChunks: 4
        }
      }
    }
  }
}
```

### Incremental Updates

```typescript
const incrementalUpdatesConfig = {
  packages: {
    workspaces: {
      incremental: {
        enabled: true,

        // Change detection
        changeDetection: {
          method: 'git-diff',
          baseBranch: 'main',
          includeDownstream: true
        },

        // Update batching
        batching: {
          strategy: 'affected',
          maxBatchSize: 10,
          respectDependencies: true
        }
      }
    }
  }
}
```

## CLI Commands

Monorepo-specific CLI commands for workspace management.

### Workspace Commands

```bash
# List all workspaces
buddy-bot workspaces list

# Scan specific workspace
buddy-bot scan --workspace packages/ui

# Update specific workspace
buddy-bot update --workspace apps/web

# Update workspace group
buddy-bot update --workspace-group frontend

# Cross-workspace updates
buddy-bot update --cascade --from packages/ui
```

### Dependency Analysis

```bash
# Analyze workspace dependencies
buddy-bot deps --workspace packages/ui --include-internal

# Check for version mismatches
buddy-bot check-versions --workspace-wide

# Validate workspace integrity
buddy-bot validate --workspaces

# Generate dependency graph
buddy-bot graph --workspaces --output deps.json
```

## Example Configurations

### Large Frontend Monorepo

```typescript
export default {
  packages: {
    workspaces: {
      autoDetect: true,

      configs: {
        'packages/design-system': {
          strategy: 'patch',
          reviewers: ['design-team'],
          autoMerge: true,
          downstream: ['apps/*']
        },
        'packages/shared-utils': {
          strategy: 'minor',
          reviewers: ['platform-team'],
          autoMerge: false,
          downstream: ['packages/*', 'apps/*']
        },
        'apps/dashboard': {
          strategy: 'minor',
          reviewers: ['dashboard-team'],
          labels: ['dashboard']
        },
        'apps/mobile': {
          strategy: 'patch',
          reviewers: ['mobile-team'],
          labels: ['mobile']
        }
      },

      coordination: {
        alignSharedDeps: true,
        sharedGroups: {
          react: {
            packages: ['react', 'react-dom'],
            synchronized: true
          }
        }
      }
    }
  }
} satisfies BuddyBotConfig
```

See [Package Management](/features/package-management) for more details on package handling strategies.
