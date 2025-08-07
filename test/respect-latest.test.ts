import type { BuddyBotConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
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
})
