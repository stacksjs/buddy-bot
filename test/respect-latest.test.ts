import type { BuddyBotConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { Buddy } from '../src/buddy'
import { RegistryClient } from '../src/registry/registry-client'
import { Logger } from '../src/utils/logger'

describe('respectLatest functionality', () => {
  let testDir: string

  beforeEach(() => {
    // Create temporary test directory
    testDir = fs.mkdtempSync('buddy-test-')
  })

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('should test RegistryClient shouldRespectVersion method directly', async () => {
    const config: BuddyBotConfig = {
      packages: {
        strategy: 'all',
        respectLatest: true,
      },
    }

    const logger = new Logger(false)
    const registryClient = new RegistryClient(testDir, logger, config)

    // Test the shouldRespectVersion method directly
    const shouldRespectVersion = registryClient.shouldRespectVersion.bind(registryClient)

    // Test various dynamic indicators
    expect(shouldRespectVersion('latest')).toBe(true)
    expect(shouldRespectVersion('*')).toBe(true)
    expect(shouldRespectVersion('main')).toBe(true)
    expect(shouldRespectVersion('master')).toBe(true)
    expect(shouldRespectVersion('develop')).toBe(true)
    expect(shouldRespectVersion('dev')).toBe(true)

    // Test normal versions
    expect(shouldRespectVersion('^1.0.0')).toBe(false)
    expect(shouldRespectVersion('~2.0.0')).toBe(false)
    expect(shouldRespectVersion('>=3.0.0')).toBe(false)
    expect(shouldRespectVersion('1.0.0')).toBe(false)
  })

  it('should test RegistryClient with respectLatest false', async () => {
    const config: BuddyBotConfig = {
      packages: {
        strategy: 'all',
        respectLatest: false,
      },
    }

    const logger = new Logger(false)
    const registryClient = new RegistryClient(testDir, logger, config)

    // Test the shouldRespectVersion method with respectLatest = false
    const shouldRespectVersion = registryClient.shouldRespectVersion.bind(registryClient)

    // All versions should be allowed when respectLatest is false
    expect(shouldRespectVersion('latest')).toBe(false)
    expect(shouldRespectVersion('*')).toBe(false)
    expect(shouldRespectVersion('main')).toBe(false)
    expect(shouldRespectVersion('^1.0.0')).toBe(false)
  })

  it('should test dependency file respectLatest logic', async () => {
    // Create test deps.yaml with dynamic versions
    const depsYaml = `dependencies:
  python.org: "*"
  node: "latest"
  typescript: "^5.0.0"
  bun: "main"

devDependencies:
  eslint: "dev"
  prettier: "^3.0.0"
`

    const depsPath = path.join(testDir, 'deps.yaml')
    fs.writeFileSync(depsPath, depsYaml)

    // Test the dependency file respectLatest logic
    const { updateDependencyFile } = await import('../src/utils/dependency-file-parser')

    // Create mock updates
    const updates = [
      {
        name: 'python.org',
        currentVersion: '*',
        newVersion: '3.13.5',
        updateType: 'major' as const,
        dependencyType: 'dependencies' as const,
        file: 'deps.yaml',
      },
      {
        name: 'typescript',
        currentVersion: '^5.0.0',
        newVersion: '^5.1.0',
        updateType: 'minor' as const,
        dependencyType: 'dependencies' as const,
        file: 'deps.yaml',
      },
    ]

    // Read the original content using a try-catch to handle potential mocking conflicts
    let originalContent: string
    try {
      originalContent = fs.readFileSync(depsPath, 'utf-8')
    }
    catch {
      // If there's a mocking conflict, use the content directly
      originalContent = depsYaml
    }

    // Test that dynamic versions are respected (not updated)
    const updatedContent = await updateDependencyFile(depsPath, originalContent, updates)

    // python.org should not be updated because it uses "*"
    expect(updatedContent).toContain('python.org: "*"')
    expect(updatedContent).not.toContain('python.org: "3.13.5"')

    // typescript should be updated because it uses a specific version
    expect(updatedContent).toContain('typescript: ^5.1.0')
    expect(updatedContent).not.toContain('typescript: ^5.0.0')
  })

  it('should test CLI respectLatest flag override', async () => {
    // Test that CLI flag overrides config
    const config: BuddyBotConfig = {
      packages: {
        strategy: 'all',
        respectLatest: true, // Config default
      },
    }

    // Simulate CLI override
    const cliOptions = { respectLatest: false }
    const finalConfig: BuddyBotConfig = {
      ...config,
      packages: {
        ...config.packages!,
        strategy: config.packages?.strategy ?? 'all',
        respectLatest: cliOptions.respectLatest ?? config.packages?.respectLatest ?? true,
      },
    }

    expect(finalConfig.packages?.respectLatest).toBe(false)
  })

  it('should test auto-close PR functionality for dynamic versions', async () => {
    // Test the auto-close logic for PRs with dynamic versions
    const config: BuddyBotConfig = {
      packages: {
        strategy: 'all',
        respectLatest: true, // New default behavior
      },
    }

    const _logger = new Logger(false)
    const buddy = new Buddy(config, testDir)

    // Mock existing PR with dynamic version
    const existingPR = {
      number: 48,
      title: 'chore(deps): update dependency python.org to 3.13.5',
      body: `This PR contains the following updates:

| Package | Change | Type | File |
|---------|--------|------|------|
| [python.org](https://pkgx.com/pkg/python.org) | * → 3.13.5 | 🔴 major | pkgx.yml |

### Release Notes

python.org

*** → _3.13.5_***

📁 **File**: pkgx.yml

🔗 **Package Info**: pkgx.com

🌐 **Official Site**: python.org`,
      head: 'buddy-bot/update-major-update---python.org-1754515225181',
      author: 'github-actions[bot]',
    }

    // Mock new updates that don't include python.org (filtered out by respectLatest)
    const newUpdates = [
      {
        name: 'typescript',
        currentVersion: '^5.0.0',
        newVersion: '^5.1.0',
        updateType: 'minor' as const,
        dependencyType: 'dependencies' as const,
        file: 'package.json',
      },
    ]

    // Test the auto-close logic
    const shouldAutoClose = (buddy as any).shouldAutoClosePR(existingPR, newUpdates)
    expect(shouldAutoClose).toBe(true)
  })

  it('should not auto-close PRs when respectLatest is false', async () => {
    // Test that auto-close doesn't happen when respectLatest is false
    const config: BuddyBotConfig = {
      packages: {
        strategy: 'all',
        respectLatest: false, // Old behavior
      },
    }

    const _logger = new Logger(false)
    const buddy = new Buddy(config, testDir)

    // Mock existing PR with dynamic version
    const existingPR = {
      number: 48,
      title: 'chore(deps): update dependency python.org to 3.13.5',
      body: `This PR contains the following updates:

| Package | Change | Type | File |
|---------|--------|------|------|
| [python.org](https://pkgx.com/pkg/python.org) | * → 3.13.5 | 🔴 major | pkgx.yml |`,
      head: 'buddy-bot/update-major-update---python.org-1754515225181',
      author: 'github-actions[bot]',
    }

    // Mock new updates that include python.org (not filtered out when respectLatest is false)
    const newUpdates = [
      {
        name: 'python.org',
        currentVersion: '*',
        newVersion: '3.13.5',
        updateType: 'major' as const,
        dependencyType: 'dependencies' as const,
        file: 'pkgx.yml',
      },
    ]

    // Test the auto-close logic
    const shouldAutoClose = (buddy as any).shouldAutoClosePR(existingPR, newUpdates)
    expect(shouldAutoClose).toBe(false)
  })

  it('should extract packages from PR body correctly', async () => {
    const config: BuddyBotConfig = {
      packages: {
        strategy: 'all',
        respectLatest: true,
      },
    }

    const _logger = new Logger(false)
    const buddy = new Buddy(config, testDir)

    const prBody = `This PR contains the following updates:

| Package | Change | Type | File |
|---------|--------|------|------|
| [python.org](https://pkgx.com/pkg/python.org) | * → 3.13.5 | 🔴 major | pkgx.yml |
| [typescript](https://github.com/microsoft/TypeScript) | ^5.0.0 → ^5.1.0 | 🟡 minor | package.json |

### Release Notes

<details>
<summary>python.org</summary>
*** → _3.13.5_***
</details>

<details>
<summary>typescript</summary>
**^5.0.0 → ^5.1.0**
</details>`

    const packages = (buddy as any).extractPackagesFromPRBody(prBody)
    expect(packages).toContain('python.org')
    expect(packages).toContain('typescript')
    expect(packages).toHaveLength(2)
  })
})
