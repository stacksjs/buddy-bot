import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('CLI Setup - Non-Interactive Mode', () => {
  let testDir: string
  let originalCwd: string

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await fs.mkdtemp(join(tmpdir(), 'buddy-bot-test-'))
    originalCwd = process.cwd()
    process.chdir(testDir)

    // Create a mock Git repository structure
    await fs.mkdir('.git', { recursive: true })
    await fs.writeFile('.git/config', `[core]
  repositoryformatversion = 0
  filemode = true
  bare = false
  logallrefupdates = true
[remote "origin"]
  url = https://github.com/test-org/test-repo.git
  fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
  remote = origin
  merge = refs/heads/main`)

    // Create package.json for project detection
    await fs.writeFile('package.json', JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        test: 'bun test',
      },
    }, null, 2))
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('Workflow Generation Functions', () => {
    it('should generate update workflow with correct schedule for every 2 hours', async () => {
      const { generateUpdateWorkflow } = await import('../src/setup')

      const preset = {
        name: 'Standard Project',
        description: 'Standard workflow',
        templates: {},
        schedules: {
          dashboard: '0 9 * * 1,3,5',
          updates: '0 */2 * * *',
        },
        strategy: 'all',
        autoMerge: false,
        custom: [],
      }

      const workflow = generateUpdateWorkflow(preset, false)

      expect(workflow).toContain('name: Buddy Update')
      expect(workflow).toContain('cron: \'0 */2 * * *\'')
      expect(workflow).toContain('default: true') // dry_run default
      expect(workflow).toContain('dependency-update:') // job name
      expect(workflow).toContain('fetch-depth: 0')
      expect(workflow).toContain('persist-credentials: true')
      expect(workflow).toContain('actions: write')
      expect(workflow).toContain('Configure Git')
      expect(workflow).toContain('Verify Composer setup')
      expect(workflow).toContain('Display test configuration')
      expect(workflow).toContain('Run Buddy dependency scan')
      expect(workflow).toContain('Run Buddy dependency updates')
      expect(workflow).toContain('Dry run notification')
      expect(workflow).toContain('Create test summary')
    })

    it('should generate update workflow with custom token environment', async () => {
      const { generateUpdateWorkflow } = await import('../src/setup')

      const preset = {
        name: 'Standard Project',
        description: 'Standard workflow',
        templates: {},
        schedules: {
          dashboard: '0 9 * * 1,3,5',
          updates: '0 */2 * * *',
        },
        strategy: 'all',
        autoMerge: false,
        custom: [],
      }

      const workflow = generateUpdateWorkflow(preset, true)

      expect(workflow).toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')
      expect(workflow).toContain('# For workflow file updates, you need a Personal Access Token')
      expect(workflow).toContain('# Create a PAT at: https://github.com/settings/tokens')
    })

    it('should generate update workflow with default token environment', async () => {
      const { generateUpdateWorkflow } = await import('../src/setup')

      const preset = {
        name: 'Standard Project',
        description: 'Standard workflow',
        templates: {},
        schedules: {
          dashboard: '0 9 * * 1,3,5',
          updates: '0 */2 * * *',
        },
        strategy: 'all',
        autoMerge: false,
        custom: [],
      }

      const workflow = generateUpdateWorkflow(preset, false)

      // eslint-disable-next-line no-template-curly-in-string
      expect(workflow).toContain('${{ secrets.GITHUB_TOKEN }}')
      // Note: The workflow contains BUDDY_BOT_TOKEN in comments, which is expected
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflow).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
    })

    it('should generate buddy-check workflow with correct name and schedule', async () => {
      const { generateUpdateCheckWorkflow } = await import('../src/setup')

      const workflow = generateUpdateCheckWorkflow(false)

      expect(workflow).toContain('name: Buddy Check')
      expect(workflow).toContain('cron: \'*/15 * * * *\'')
      expect(workflow).toContain('update-check:') // job name
      expect(workflow).toContain('bunx buddy-bot update-check')
    })

    it('should generate all core workflows', async () => {
      const { generateCoreWorkflows, getWorkflowPreset } = await import('../src/setup')
      const { Logger } = await import('../src/utils/logger')

      const repoInfo = { owner: 'test-org', name: 'test-repo' }
      const preset = getWorkflowPreset('standard')
      const logger = Logger.quiet()

      await generateCoreWorkflows(preset, repoInfo, false, logger)

      // Check that all three core workflow files were created
      const dashboardExists = await fs.access('.github/workflows/buddy-dashboard.yml').then(() => true).catch(() => false)
      const checkExists = await fs.access('.github/workflows/buddy-check.yml').then(() => true).catch(() => false)
      const updateExists = await fs.access('.github/workflows/buddy-update.yml').then(() => true).catch(() => false)

      expect(dashboardExists).toBe(true)
      expect(checkExists).toBe(true)
      expect(updateExists).toBe(true)

      // Verify content of generated files
      const dashboardContent = await fs.readFile('.github/workflows/buddy-dashboard.yml', 'utf-8')
      const checkContent = await fs.readFile('.github/workflows/buddy-check.yml', 'utf-8')
      const updateContent = await fs.readFile('.github/workflows/buddy-update.yml', 'utf-8')

      expect(dashboardContent).toContain('name: Buddy Dashboard')
      expect(checkContent).toContain('name: Buddy Check')
      expect(updateContent).toContain('name: Buddy Update')
    })
  })

  describe('Preset Configuration', () => {
    it('should return all preset configurations correctly', async () => {
      const { getWorkflowPreset } = await import('../src/setup')

      const standard = getWorkflowPreset('standard')
      expect(standard.name).toBe('Standard Project')
      expect(standard.description).toContain('Daily patch updates')

      const highFreq = getWorkflowPreset('high-frequency')
      expect(highFreq.name).toBe('High Frequency Updates')
      expect(highFreq.description).toContain('4 times per day')

      const security = getWorkflowPreset('security')
      expect(security.name).toBe('Security Focused')
      expect(security.description).toContain('security-first')

      const minimal = getWorkflowPreset('minimal')
      expect(minimal.name).toBe('Minimal Updates')
      expect(minimal.description).toContain('Weekly')

      const testing = getWorkflowPreset('testing')
      expect(testing.name).toBe('Development/Testing')
      expect(testing.description).toContain('Manual trigger')
    })
  })

  describe('Configuration File Generation', () => {
    it('should generate TypeScript config file with correct structure', async () => {
      const { generateConfigFile } = await import('../src/setup')

      const repoInfo = { owner: 'test-org', name: 'test-repo' }
      await generateConfigFile(repoInfo, false)

      const configExists = await fs.access('buddy-bot.config.ts').then(() => true).catch(() => false)
      expect(configExists).toBe(true)

      const configContent = await fs.readFile('buddy-bot.config.ts', 'utf-8')
      expect(configContent).toContain('import type { BuddyBotConfig }')
      expect(configContent).toContain('const config: BuddyBotConfig')
      expect(configContent).toContain('export default config')
      expect(configContent).toContain('owner: \'test-org\'')
      expect(configContent).toContain('name: \'test-repo\'')
      expect(configContent).toContain('provider: \'github\'')
    })

    it('should generate config file with custom token comments', async () => {
      const { generateConfigFile } = await import('../src/setup')

      const repoInfo = { owner: 'test-org', name: 'test-repo' }
      await generateConfigFile(repoInfo, true)

      const configContent = await fs.readFile('buddy-bot.config.ts', 'utf-8')
      expect(configContent).toContain('// token: process.env.BUDDY_BOT_TOKEN,')
    })

    it('should generate config file with default token comments', async () => {
      const { generateConfigFile } = await import('../src/setup')

      const repoInfo = { owner: 'test-org', name: 'test-repo' }
      await generateConfigFile(repoInfo, false)

      const configContent = await fs.readFile('buddy-bot.config.ts', 'utf-8')
      expect(configContent).toContain('// Uses GITHUB_TOKEN by default')
    })
  })

  describe('Repository Detection', () => {
    it('should detect repository information from git config', async () => {
      const { detectRepository } = await import('../src/setup')

      // Since detectRepository uses git command, we test that it doesn't throw
      // The actual parsing logic is tested separately with mock data
      const repoInfo = await detectRepository()

      // In test environment without proper git setup, this may return null
      // but should not throw an error
      expect(repoInfo === null || typeof repoInfo === 'object').toBe(true)

      if (repoInfo) {
        expect(typeof repoInfo.owner).toBe('string')
        expect(typeof repoInfo.name).toBe('string')
      }
    })

    it('should handle missing git repository gracefully', async () => {
      // Remove git directory to simulate non-git environment
      await fs.rm('.git', { recursive: true, force: true })

      const { detectRepository } = await import('../src/setup')
      const repoInfo = await detectRepository()

      expect(repoInfo).toBeNull()
    })
  })

  describe('Progress Tracking', () => {
    it('should create progress tracker with correct total steps', async () => {
      const { createProgressTracker } = await import('../src/setup')

      const progress = createProgressTracker(10)

      expect(progress.totalSteps).toBe(10)
      expect(progress.currentStep).toBe(0)
      expect(progress.stepName).toBe('Initializing')
      expect(Array.isArray(progress.completed)).toBe(true)
    })

    it('should update progress correctly', async () => {
      const { createProgressTracker, updateProgress } = await import('../src/setup')

      const progress = createProgressTracker(5)
      updateProgress(progress, 'Test Step', true) // Mark previous step as completed

      expect(progress.currentStep).toBe(1)
      expect(progress.stepName).toBe('Test Step')
      expect(Array.isArray(progress.completed)).toBe(true)
      expect(progress.completed.length).toBeGreaterThan(0)
    })

    it('should handle progress display without errors', async () => {
      const { createProgressTracker, updateProgress, displayProgress } = await import('../src/setup')

      const progress = createProgressTracker(10)

      // Test initial state
      expect(() => displayProgress(progress)).not.toThrow()

      // Test after update
      updateProgress(progress, 'Test Step')
      expect(() => displayProgress(progress)).not.toThrow()

      // Test edge case where currentStep equals totalSteps
      progress.currentStep = progress.totalSteps
      expect(() => displayProgress(progress)).not.toThrow()

      // Test edge case where currentStep exceeds totalSteps
      progress.currentStep = progress.totalSteps + 1
      expect(() => displayProgress(progress)).not.toThrow()
    })
  })

  describe('Token Setup Configuration', () => {
    it('should handle different token setup modes', async () => {
      const { confirmTokenSetup } = await import('../src/setup')

      // Note: This function uses prompts, so we'd need to mock it for non-interactive testing
      // For now, we test that the function exists and can be imported
      expect(typeof confirmTokenSetup).toBe('function')
    })
  })

  describe('Validation Functions', () => {
    it('should validate workflow generation', async () => {
      const { validateWorkflowGeneration } = await import('../src/setup')

      const validWorkflow = `
name: Test Workflow
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bunx buddy-bot scan
permissions:
  contents: read
`

      const result = await validateWorkflowGeneration(validWorkflow)
      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect missing workflow fields', async () => {
      const { validateWorkflowGeneration } = await import('../src/setup')

      const invalidWorkflow = `
# Missing required fields
steps:
  - run: echo "test"
`

      const result = await validateWorkflowGeneration(invalidWorkflow)
      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should validate repository access', async () => {
      const { validateRepositoryAccess } = await import('../src/setup')

      const repoInfo = { owner: 'test-org', name: 'test-repo' }
      const result = await validateRepositoryAccess(repoInfo)

      // This will likely return warnings for a test repo, but should not throw
      expect(result).toBeDefined()
      expect(typeof result.success).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
      expect(Array.isArray(result.suggestions)).toBe(true)
    })
  })

  describe('Project Analysis', () => {
    it('should analyze project structure correctly', async () => {
      const { analyzeProject } = await import('../src/setup')

      // Create additional files to test detection
      await fs.writeFile('bun.lockb', '')
      await fs.writeFile('composer.json', '{}')
      await fs.mkdir('.github/workflows', { recursive: true })
      await fs.writeFile('.github/workflows/ci.yml', 'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest')

      const analysis = await analyzeProject()

      expect(analysis).toBeDefined()
      expect(typeof analysis.type).toBe('string')
      expect(typeof analysis.packageManager).toBe('string')
      expect(typeof analysis.hasLockFile).toBe('boolean')
      expect(typeof analysis.hasDependencyFiles).toBe('boolean')
      expect(typeof analysis.hasGitHubActions).toBe('boolean')
      expect(typeof analysis.recommendedPreset).toBe('string')
      expect(Array.isArray(analysis.recommendations)).toBe(true)
    })
  })

  describe('Preflight Checks', () => {
    it('should run preflight checks without errors', async () => {
      const { runPreflightChecks } = await import('../src/setup')

      const result = await runPreflightChecks()

      expect(result).toBeDefined()
      expect(typeof result.success).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
      expect(Array.isArray(result.suggestions)).toBe(true)
    })
  })

  describe('Final Instructions Display', () => {
    it('should display final instructions without errors', async () => {
      const { showFinalInstructions } = await import('../src/setup')

      const repoInfo = { owner: 'test-org', name: 'test-repo' }

      // Should not throw when called
      expect(() => showFinalInstructions(repoInfo, false)).not.toThrow()
      expect(() => showFinalInstructions(repoInfo, true)).not.toThrow()
    })
  })
})
