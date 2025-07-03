# Release Notes

Buddy automatically extracts, formats, and includes release notes in pull requests to provide context about package updates and their impact.

## Automatic Release Notes Extraction

Buddy intelligently extracts release notes from multiple sources to provide comprehensive update information.

### Data Sources

#### GitHub Releases
```typescript
const githubReleasesConfig = {
  releaseNotes: {
    sources: {
      githubReleases: {
        enabled: true,
        includePrerelease: false,
        includeDraft: false,
        maxAge: 365 // days
      }
    }
  }
}
```

#### Changelog Files
```typescript
const changelogConfig = {
  releaseNotes: {
    sources: {
      changelog: {
        enabled: true,
        files: ['CHANGELOG.md', 'HISTORY.md', 'RELEASES.md'],
        formats: ['keep-a-changelog', 'common-changelog'],
        maxEntries: 10
      }
    }
  }
}
```

#### NPM Registry
```typescript
const npmRegistryConfig = {
  releaseNotes: {
    sources: {
      npmRegistry: {
        enabled: true,
        includeDescription: true,
        includeKeywords: true,
        maxVersionHistory: 5
      }
    }
  }
}
```

#### Git Commits
```typescript
const gitCommitsConfig = {
  releaseNotes: {
    sources: {
      gitCommits: {
        enabled: true,
        conventionalCommits: true,
        maxCommits: 20,
        groupByType: true
      }
    }
  }
}
```

## Release Notes Processing

Buddy processes and formats release notes for clarity and consistency.

### Content Formatting

```typescript
export default {
  releaseNotes: {
    formatting: {
      // Markdown processing
      markdown: {
        sanitize: true, // Remove unsafe HTML
        preserveLinks: true, // Keep links intact
        maxLength: 2000, // Truncate long notes
        removeEmptyLines: true // Clean up formatting
      },

      // Content filtering
      filters: {
        excludePatterns: [
          /^chore:/, // Exclude chore commits
          /^docs:/, // Exclude documentation
          /dependabot/i // Exclude dependabot commits
        ],
        includeTypes: [
          'feat',
          'fix',
          'perf',
          'security'
        ]
      },

      // Content enhancement
      enhance: {
        linkIssues: true, // Link issue references
        linkPRs: true, // Link PR references
        formatBreaking: true, // Highlight breaking changes
        addEmojis: false // Add type emojis
      }
    }
  }
} satisfies BuddyBotConfig
```

### Breaking Changes Detection

Automatically detect and highlight breaking changes:

```typescript
const breakingChangesConfig = {
  releaseNotes: {
    breakingChanges: {
      detection: {
        keywords: [
          'BREAKING CHANGE',
          'BREAKING:',
          'breaking change',
          'breaking',
          'incompatible'
        ],
        semverMajor: true, // Detect from version bump
        commitFooter: true // Check commit footers
      },

      formatting: {
        highlight: true, // Highlight in notes
        separate: true, // Separate section
        emoji: '⚠️', // Warning emoji
        label: 'Breaking Changes'
      }
    }
  }
}
```

## Release Notes Templates

Customize how release notes appear in pull requests.

### Template Configuration

```typescript
export default {
  releaseNotes: {
    template: {
      // Header template
      header: '## 📋 Release Notes\n\n',

      // Package section template
      packageSection: `
### {packageName} {currentVersion} → {targetVersion}

{releaseNotes}

{breakingChanges}

---
`,

      // Footer template
      footer: '\n*Release notes extracted from GitHub releases, changelogs, and commit history.*',

      // Empty state
      empty: 'No release notes available for this update.',

      // Error handling
      error: 'Unable to fetch release notes. See package documentation for details.'
    }
  }
} satisfies BuddyBotConfig
```

### Custom Templates

```typescript
const customTemplatesConfig = {
  releaseNotes: {
    customTemplates: {
      // Security update template
      security: `
## 🔒 Security Update

**{packageName}** has been updated from **{currentVersion}** to **{targetVersion}** to address security vulnerabilities.

### Security Fixes
{securityFixes}

### Other Changes
{otherChanges}

**Recommendation:** This update should be applied immediately.
`,

      // Major update template
      major: `
## 🚀 Major Update

**{packageName}** has been updated from **{currentVersion}** to **{targetVersion}**.

⚠️ **This is a major version update and may contain breaking changes.**

### What's New
{newFeatures}

### Breaking Changes
{breakingChanges}

### Migration Guide
{migrationGuide}

**Action Required:** Review breaking changes and update code as needed.
`,

      // Patch update template
      patch: `
## 🐛 Bug Fixes

**{packageName}** {currentVersion} → {targetVersion}

{releaseNotes}
`
    }
  }
}
```

## Release Notes Aggregation

For pull requests with multiple packages, Buddy intelligently aggregates release notes.

### Grouping Strategies

```typescript
const groupingStrategiesConfig = {
  releaseNotes: {
    aggregation: {
      // Group by update type
      groupByType: {
        enabled: true,
        types: {
          security: 'Security Updates',
          major: 'Major Updates',
          minor: 'Feature Updates',
          patch: 'Bug Fixes'
        }
      },

      // Group by ecosystem
      groupByEcosystem: {
        enabled: true,
        ecosystems: {
          react: 'React Ecosystem',
          vue: 'Vue.js Ecosystem',
          testing: 'Testing Tools',
          build: 'Build Tools'
        }
      },

      // Priority ordering
      priorityOrder: [
        'security',
        'breaking',
        'major',
        'minor',
        'patch'
      ]
    }
  }
}
```

### Summary Generation

```typescript
const summaryGenerationConfig = {
  releaseNotes: {
    summary: {
      enabled: true,

      // Summary template
      template: `
## 📊 Update Summary

- **{totalPackages}** packages updated
- **{securityUpdates}** security updates
- **{majorUpdates}** major updates
- **{minorUpdates}** minor updates
- **{patchUpdates}** patch updates

{topChanges}
`,

      // Top changes extraction
      topChanges: {
        maxItems: 5,
        prioritize: ['security', 'breaking', 'new-features'],
        format: '• {change} ({package})'
      }
    }
  }
}
```

## Advanced Features

### Release Notes Caching

```typescript
const cachingConfig = {
  releaseNotes: {
    caching: {
      enabled: true,
      ttl: 86400, // 24 hours
      storage: 'memory', // 'memory' | 'disk' | 'redis'

      // Cache invalidation
      invalidateOn: [
        'new-release',
        'changelog-update',
        'tag-creation'
      ]
    }
  }
}
```

### External Integration

```typescript
const externalIntegrationConfig = {
  releaseNotes: {
    external: {
      // Custom release notes API
      api: {
        enabled: false,
        endpoint: 'https://api.company.com/release-notes',
        headers: {
          Authorization: 'Bearer {token}'
        }
      },

      // Webhook notifications
      webhooks: {
        onExtract: 'https://api.company.com/webhooks/release-notes',
        onError: 'https://api.company.com/webhooks/errors'
      }
    }
  }
}
```

### Content Enhancement

```typescript
const contentEnhancementConfig = {
  releaseNotes: {
    enhancement: {
      // Link detection and formatting
      links: {
        autoLink: true,
        domains: ['github.com', 'company.com'],
        format: '[{text}]({url})'
      },

      // Issue and PR linking
      references: {
        github: {
          issues: true,
          pullRequests: true,
          format: '[#{number}]({url})'
        }
      },

      // Emoji enhancement
      emojis: {
        enabled: false,
        mapping: {
          feat: '✨',
          fix: '🐛',
          security: '🔒',
          breaking: '⚠️'
        }
      }
    }
  }
}
```

## Error Handling

Robust error handling for release notes extraction failures.

### Fallback Strategies

```typescript
const fallbackStrategiesConfig = {
  releaseNotes: {
    errorHandling: {
      // Fallback sources
      fallbacks: [
        'github-releases',
        'changelog-file',
        'git-commits',
        'package-json'
      ],

      // Retry configuration
      retry: {
        maxAttempts: 3,
        delay: 1000,
        backoff: 'exponential'
      },

      // Graceful degradation
      gracefulDegradation: {
        enabled: true,
        minimalTemplate: 'Updated {packageName} from {currentVersion} to {targetVersion}',
        showErrors: false
      }
    }
  }
}
```

## CLI Commands

Manage release notes via CLI:

```bash
# Extract release notes for a package
buddy-bot release-notes react 18.0.0 18.2.0

# Preview release notes for current updates
buddy-bot release-notes --preview

# Cache release notes
buddy-bot release-notes --cache-update

# Test release notes template
buddy-bot release-notes --template-test
```

## Integration Examples

### Security-Focused Configuration

```typescript
export default {
  releaseNotes: {
    prioritize: ['security', 'breaking'],

    template: {
      header: '## 🔒 Security & Critical Updates\n\n',
      packageSection: `
### {packageName} Security Update
**Version:** {currentVersion} → {targetVersion}
**Severity:** {severity}

{securityNotes}

{additionalNotes}
`
    },

    breakingChanges: {
      highlight: true,
      separate: true,
      requireAcknowledgment: true
    }
  }
} satisfies BuddyBotConfig
```

### Minimal Configuration

```typescript
export default {
  releaseNotes: {
    sources: {
      githubReleases: { enabled: true },
      changelog: { enabled: false },
      gitCommits: { enabled: false }
    },

    formatting: {
      maxLength: 500,
      filters: {
        includeTypes: ['fix', 'security']
      }
    },

    template: {
      packageSection: '**{packageName}** {currentVersion} → {targetVersion}\n{releaseNotes}\n'
    }
  }
} satisfies BuddyBotConfig
```

## Performance Optimization

### Parallel Processing

```typescript
const performanceConfig = {
  releaseNotes: {
    performance: {
      parallel: {
        enabled: true,
        maxConcurrency: 5,
        batchSize: 10
      },

      // Request optimization
      requests: {
        timeout: 10000,
        retries: 2,
        rateLimit: {
          requests: 60,
          window: 60000
        }
      }
    }
  }
}
```

See [Pull Request Generation](/features/pull-requests) for how release notes integrate into the complete PR workflow.
