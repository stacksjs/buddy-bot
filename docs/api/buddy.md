# Buddy Class API

The `Buddy` class is the main entry point for programmatic dependency management. It provides methods for scanning dependencies, creating pull requests, and managing updates.

## Constructor

```typescript
new Buddy(config: BuddyBotConfig, projectPath?: string)
```

### Parameters

- **config** (`BuddyBotConfig`): Configuration object
- **projectPath** (`string`, optional): Project root path (defaults to `process.cwd()`)

### Example

```typescript
import { Buddy } from 'buddy-bot'

const buddy = new Buddy({
  verbose: true,
  repository: {
    provider: 'github',
    owner: 'your-org',
    name: 'your-repo'
  },
  packages: {
    strategy: 'patch',
    ignore: ['@types/node']
  }
}, '/path/to/project')
```

## Core Methods

### scanForUpdates()

Scans the project for available dependency updates.

```typescript
async scanForUpdates(): Promise<UpdateScanResult>
```

#### Returns

`UpdateScanResult` object containing:

```typescript
interface UpdateScanResult {
  updates: PackageUpdate[]
  groups: UpdateGroup[]
  metadata: {
    scanTime: Date
    strategy: string
    packageCount: number
  }
}
```

#### Example

```typescript
const buddy = new Buddy(config)
const scanResult = await buddy.scanForUpdates()

console.log(`Found ${scanResult.updates.length} updates`)
scanResult.groups.forEach(group => {
  console.log(`${group.name}: ${group.updates.length} packages`)
})
```

### createPullRequests()

Creates pull requests for dependency updates.

```typescript
async createPullRequests(scanResult: UpdateScanResult): Promise<void>
```

#### Parameters

- **scanResult** (`UpdateScanResult`): Result from `scanForUpdates()`

#### Example

```typescript
const scanResult = await buddy.scanForUpdates()

if (scanResult.updates.length > 0) {
  await buddy.createPullRequests(scanResult)
  console.log('Pull requests created successfully')
}
```

### run()

Runs the complete update process (scan + create PRs).

```typescript
async run(): Promise<UpdateScanResult>
```

#### Returns

`UpdateScanResult` with the scan results

#### Example

```typescript
const buddy = new Buddy(config)
const result = await buddy.run()

if (result.updates.length === 0) {
  console.log('No updates available!')
} else {
  console.log(`Created PRs for ${result.groups.length} update groups`)
}
```

### checkPackages()

Checks specific packages for updates.

```typescript
async checkPackages(packageNames: string[]): Promise<PackageUpdate[]>
```

#### Parameters

- **packageNames** (`string[]`): Array of package names to check

#### Returns

Array of `PackageUpdate` objects

#### Example

```typescript
const updates = await buddy.checkPackages(['react', 'typescript'])

updates.forEach(update => {
  console.log(`${update.name}: ${update.currentVersion} → ${update.newVersion}`)
})
```

## Utility Methods

### generatePackageJsonUpdates()

Generates package.json file changes for updates.

```typescript
async generatePackageJsonUpdates(updates: PackageUpdate[]): Promise<Array<{
  path: string
  content: string
  type: 'update'
}>>
```

#### Parameters

- **updates** (`PackageUpdate[]`): Array of package updates

#### Returns

Array of file change objects

#### Example

```typescript
const updates = await buddy.scanForUpdates()
const fileChanges = await buddy.generatePackageJsonUpdates(updates.updates)

fileChanges.forEach(change => {
  console.log(`Updated ${change.path}`)
  // change.content contains the new file content
})
```

### getConfig()

Returns the current configuration.

```typescript
getConfig(): BuddyBotConfig
```

#### Returns

The current `BuddyBotConfig` object

#### Example

```typescript
const config = buddy.getConfig()
console.log(`Strategy: ${config.packages?.strategy}`)
```

## Types

### BuddyBotConfig

Main configuration interface:

```typescript
interface BuddyBotConfig {
  verbose?: boolean
  repository?: {
    provider: 'github' | 'gitlab' | 'bitbucket'
    owner: string
    name: string
    baseBranch?: string
    token?: string
  }
  packages?: {
    strategy: 'major' | 'minor' | 'patch' | 'all'
    ignore?: string[]
    pin?: Record<string, string>
    groups?: PackageGroup[]
  }
  pullRequest?: {
    commitMessageFormat?: string
    titleFormat?: string
    bodyTemplate?: string
    autoMerge?: {
      enabled: boolean
      strategy: 'merge' | 'squash' | 'rebase'
      conditions?: string[]
    }
    reviewers?: string[]
    assignees?: string[]
    labels?: string[]
  }
  schedule?: {
    cron?: string
    timezone?: string
  }
}
```

### PackageUpdate

Represents a single package update:

```typescript
interface PackageUpdate {
  name: string
  currentVersion: string
  newVersion: string
  updateType: 'major' | 'minor' | 'patch'
  dependencyType: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'
  repository?: string
  homepage?: string
  description?: string
  changelog?: string
}
```

### UpdateGroup

Groups related package updates:

```typescript
interface UpdateGroup {
  name: string
  title: string
  updates: PackageUpdate[]
  strategy: string
}
```

### UpdateScanResult

Result of scanning for updates:

```typescript
interface UpdateScanResult {
  updates: PackageUpdate[]
  groups: UpdateGroup[]
  metadata: {
    scanTime: Date
    strategy: string
    packageCount: number
    ignoredCount: number
  }
}
```

## Error Handling

The Buddy class throws errors for various failure scenarios:

### Configuration Errors

```typescript
try {
  const buddy = new Buddy(invalidConfig)
} catch (error) {
  if (error.message.includes('Repository configuration required')) {
    // Handle missing repository config
  }
}
```

### GitHub Token Errors

```typescript
try {
  await buddy.createPullRequests(scanResult)
} catch (error) {
  if (error.message.includes('GITHUB_TOKEN')) {
    // Handle missing or invalid GitHub token
  }
}
```

### Network Errors

```typescript
try {
  const scanResult = await buddy.scanForUpdates()
} catch (error) {
  if (error.code === 'ENOTFOUND') {
    // Handle network connectivity issues
  }
}
```

## Advanced Usage

### Custom Package Groups

```typescript
const buddy = new Buddy({
  packages: {
    strategy: 'all',
    groups: [
      {
        name: 'React Ecosystem',
        packages: ['react', 'react-dom', '@types/react'],
        strategy: 'minor'
      },
      {
        name: 'Testing Tools',
        packages: ['jest', '@types/jest', 'testing-library/*'],
        strategy: 'patch'
      }
    ]
  }
})
```

### Conditional Updates

```typescript
const scanResult = await buddy.scanForUpdates()

// Only create PRs for patch updates
const patchUpdates = scanResult.updates.filter(u => u.updateType === 'patch')
if (patchUpdates.length > 0) {
  const patchScanResult = {
    ...scanResult,
    updates: patchUpdates,
    groups: scanResult.groups.map(g => ({
      ...g,
      updates: g.updates.filter(u => u.updateType === 'patch')
    })).filter(g => g.updates.length > 0)
  }

  await buddy.createPullRequests(patchScanResult)
}
```

### Integration with CI/CD

```typescript
import { Buddy } from 'buddy-bot'

async function updateDependencies() {
  const buddy = new Buddy({
    verbose: process.env.NODE_ENV === 'development',
    repository: {
      provider: 'github',
      owner: process.env.GITHUB_OWNER!,
      name: process.env.GITHUB_REPO!,
    },
    packages: {
      strategy: process.env.UPDATE_STRATEGY as any || 'patch'
    }
  })

  try {
    const result = await buddy.run()

    if (result.updates.length === 0) {
      console.log('✅ All dependencies are up to date')
      process.exit(0)
    }

    console.log(`✅ Created ${result.groups.length} PR(s) for ${result.updates.length} updates`)
  } catch (error) {
    console.error('❌ Update failed:', error)
    process.exit(1)
  }
}

// Run in CI environment
if (process.env.CI) {
  updateDependencies()
}
```
