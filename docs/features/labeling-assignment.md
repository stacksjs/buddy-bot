# Labeling & Assignment

Buddy provides intelligent labeling and team assignment features to ensure proper pull request categorization and review workflows.

## Dynamic Labeling

Buddy automatically applies contextual labels based on package characteristics, update types, and change scope.

### Default Label Categories

#### Update Type Labels
- `patch-update` - Patch version updates (bug fixes)
- `minor-update` - Minor version updates (new features)
- `major-update` - Major version updates (breaking changes)
- `security-update` - Security-related updates
- `dependencies` - General dependency label

#### Package Ecosystem Labels
- `react-ecosystem` - React and related packages
- `vue-ecosystem` - Vue.js and related packages
- `angular-ecosystem` - Angular framework packages
- `typescript` - TypeScript and type definitions
- `testing` - Testing frameworks and utilities
- `build-tools` - Build and bundling tools
- `dev-dependencies` - Development-only packages

#### Scope Labels
- `single-package` - Updates affecting one package
- `multi-package` - Updates affecting multiple packages
- `monorepo-update` - Monorepo workspace updates
- `breaking-changes` - Updates with breaking changes

### Configuration

```typescript
export default {
  pullRequest: {
    labels: {
      // Static labels (always applied)
      static: ['dependencies', 'automated'],

      // Dynamic labeling rules
      dynamic: {
        enabled: true,

        // Update type labeling
        updateType: {
          patch: 'patch-update',
          minor: 'minor-update',
          major: 'major-update',
          security: 'security-update'
        },

        // Package ecosystem detection
        ecosystems: {
          react: ['react*', '@types/react*'],
          vue: ['vue*', '@vue/*'],
          angular: ['@angular/*'],
          typescript: ['typescript', '@types/*'],
          testing: ['jest', 'vitest', '@testing-library/*']
        },

        // Custom label rules
        rules: [
          {
            condition: 'packages.includes("@types/")',
            label: 'type-definitions'
          },
          {
            condition: 'packageCount > 5',
            label: 'large-update'
          },
          {
            condition: 'hasBreakingChanges',
            label: 'breaking-changes'
          }
        ]
      }
    }
  }
} satisfies BuddyBotConfig
```

### Custom Label Rules

#### Pattern-Based Labeling

```typescript
const patternLabeling = {
  pullRequest: {
    labels: {
      patterns: {
        '@types/*': ['type-definitions', 'typescript'],
        'eslint*': ['linting', 'code-quality'],
        'babel*': ['build-tools', 'transpilation'],
        '*test*': ['testing'],
        '*security*': ['security']
      }
    }
  }
}
```

#### Conditional Labeling

```typescript
const conditionalLabeling = {
  pullRequest: {
    labels: {
      conditions: [
        {
          when: pr => pr.packages.length === 1,
          apply: ['single-package']
        },
        {
          when: pr => pr.packages.some(p => p.hasBreakingChanges),
          apply: ['breaking-changes', 'requires-review']
        },
        {
          when: pr => pr.updateType === 'security',
          apply: ['security', 'high-priority']
        },
        {
          when: pr => pr.packages.every(p => p.isDevDependency),
          apply: ['dev-only', 'low-risk']
        }
      ]
    }
  }
}
```

## Team Assignment

Intelligent assignment of reviewers and assignees based on package ownership and team structure.

### Reviewer Assignment

#### Global Reviewers

```typescript
export default {
  pullRequest: {
    reviewers: ['tech-lead', 'senior-dev'],

    // Review requirements
    reviewRequirements: {
      required: 1, // Minimum required reviews
      teamReviews: true, // Count team reviews
      dismissStale: true // Dismiss stale reviews
    }
  }
} satisfies BuddyBotConfig
```

#### Package-Based Assignment

```typescript
const packageBasedAssignment = {
  pullRequest: {
    packageOwners: {
      'react': ['frontend-team', 'react-expert'],
      'vue': ['vue-team'],
      '@types/*': ['typescript-team'],
      'eslint*': ['code-quality-team'],
      'jest': ['testing-team'],
      'webpack': ['build-team'],
      '@company/*': ['platform-team']
    },

    // Fallback reviewers
    fallbackReviewers: ['tech-lead', 'senior-dev']
  }
}
```

#### Team-Based Assignment

```typescript
const teamBasedAssignment = {
  pullRequest: {
    teams: {
      frontend: {
        members: ['alice', 'bob', 'charlie'],
        packages: ['react*', 'vue*', '@types/react*'],
        requiredReviews: 2
      },
      backend: {
        members: ['david', 'eve'],
        packages: ['express*', '@types/node*'],
        requiredReviews: 1
      },
      devtools: {
        members: ['frank', 'grace'],
        packages: ['eslint*', 'prettier*', 'webpack*'],
        autoAssign: true
      }
    }
  }
}
```

### Assignee Management

#### Automatic Assignment

```typescript
export default {
  pullRequest: {
    assignees: {
      // Static assignees
      static: ['maintainer'],

      // Dynamic assignment rules
      rules: [
        {
          condition: 'updateType === "security"',
          assignees: ['security-team']
        },
        {
          condition: 'packages.includes("react")',
          assignees: ['frontend-lead']
        },
        {
          condition: 'packageCount > 10',
          assignees: ['tech-lead']
        }
      ],

      // Assignment limits
      maxAssignees: 3,
      requiresAssignee: true
    }
  }
} satisfies BuddyBotConfig
```

## CLI Label Management

Manage labels and assignments via CLI:

```bash
# List current labels
buddy-bot labels list

# Create custom label
buddy-bot labels create "custom-label" --color "ff0000" --description "Custom label"

# Assign reviewers to PR
buddy-bot assign 123 --reviewers alice,bob --assignees charlie

# Update PR labels
buddy-bot labels update 123 --add security --remove low-priority
```

## Automation Examples

### Security-First Assignment

```typescript
export default {
  pullRequest: {
    labels: {
      rules: [
        {
          condition: 'isSecurityUpdate',
          labels: ['security', 'high-priority', 'auto-merge-approved']
        }
      ]
    },

    assignees: {
      rules: [
        {
          condition: 'isSecurityUpdate',
          assignees: ['security-team'],
          reviewers: ['security-lead', 'tech-lead'],
          urgency: 'high'
        }
      ]
    }
  }
} satisfies BuddyBotConfig
```

### Development Workflow

```typescript
export default {
  pullRequest: {
    labels: {
      rules: [
        {
          condition: 'isDevDependency && updateType === "patch"',
          labels: ['dev-only', 'auto-merge', 'low-risk']
        },
        {
          condition: 'isProductionDependency && updateType === "major"',
          labels: ['production', 'breaking-changes', 'requires-testing']
        }
      ]
    },

    assignees: {
      rules: [
        {
          condition: 'isDevDependency',
          assignees: ['dev-lead'],
          reviewers: ['senior-dev']
        },
        {
          condition: 'isProductionDependency',
          assignees: ['tech-lead'],
          reviewers: ['tech-lead', 'senior-dev-1', 'senior-dev-2']
        }
      ]
    }
  }
} satisfies BuddyBotConfig
```

See [Pull Request Generation](/features/pull-requests) for more details on how labeling and assignment integrate with the overall PR workflow.
