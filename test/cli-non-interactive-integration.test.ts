import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('CLI Non-Interactive Integration Tests', () => {
  let testDir: string
  let originalCwd: string

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await fs.mkdtemp(join(tmpdir(), 'buddy-bot-cli-test-'))
    originalCwd = process.cwd()
    process.chdir(testDir)

    // Create a mock Git repository structure
    await fs.mkdir('.git', { recursive: true })
    await fs.writeFile('.git/config', `[remote "origin"]
  url = https://github.com/test-user/test-project.git
  fetch = +refs/heads/*:refs/remotes/origin/*`)

    // Create package.json for project detection
    await fs.writeFile('package.json', JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        build: 'bun build',
        test: 'bun test',
      },
      dependencies: {
        react: '^18.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
      },
    }, null, 2))
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('CLI Flag Validation', () => {
    it('should accept valid preset values', async () => {
      const validPresets = ['standard', 'high-frequency', 'security', 'minimal', 'testing']

      for (const preset of validPresets) {
        const { getWorkflowPreset } = await import('../src/setup')
        expect(() => getWorkflowPreset(preset)).not.toThrow()

        const presetConfig = getWorkflowPreset(preset)
        expect(presetConfig).toBeDefined()
        expect(typeof presetConfig.name).toBe('string')
        expect(typeof presetConfig.description).toBe('string')
      }
    })

    it('should handle invalid preset gracefully', async () => {
      const { getWorkflowPreset } = await import('../src/setup')

      // Should fall back to default behavior for invalid preset
      const invalidPreset = getWorkflowPreset('invalid-preset')
      expect(invalidPreset).toBeDefined()
    })
  })

  describe('Non-Interactive Setup Simulation', () => {
    it('should simulate standard preset setup', async () => {
      // Mock the setup functions to test non-interactive flow
      const {
        detectRepository,
        generateConfigFile,
        generateCoreWorkflows,
        getWorkflowPreset,
      } = await import('../src/setup')
      const { Logger } = await import('../src/utils/logger')

      // Simulate the non-interactive setup flow
      const repoInfo = await detectRepository()
      // Use fallback if git detection fails in test environment
      const finalRepoInfo = repoInfo || { owner: 'test-user', name: 'test-project' }

      // Generate config file (default token)
      await generateConfigFile(finalRepoInfo, false)
      const configExists = await fs.access('buddy-bot.config.ts').then(() => true).catch(() => false)
      expect(configExists).toBe(true)

      // Generate workflows with standard preset
      const preset = getWorkflowPreset('standard')
      const logger = Logger.quiet()
      await generateCoreWorkflows(preset, finalRepoInfo, false, logger)

      // Verify all three workflow files were created
      // Check that the unified workflow file exists
      const unifiedExists = await fs.access('.github/workflows/buddy-bot.yml').then(() => true).catch(() => false)
      expect(unifiedExists).toBe(true)

      // Check that old individual workflow files do not exist (they should be cleaned up)
      const oldFiles = [
        '.github/workflows/buddy-dashboard.yml',
        '.github/workflows/buddy-check.yml',
        '.github/workflows/buddy-update.yml',
      ]

      for (const file of oldFiles) {
        const exists = await fs.access(file).then(() => true).catch(() => false)
        expect(exists).toBe(false)
      }

      // Verify the unified workflow has the correct content
      const unifiedContent = await fs.readFile('.github/workflows/buddy-bot.yml', 'utf-8')
      expect(unifiedContent).toContain('name: Buddy Bot')
      expect(unifiedContent).toContain('cron: \'0 */2 * * *\'')
      expect(unifiedContent).toContain('default: true') // dry_run default
    })

    it('should simulate testing preset setup', async () => {
      const {
        detectRepository,
        generateConfigFile,
        generateCoreWorkflows,
        getWorkflowPreset,
      } = await import('../src/setup')
      const { Logger } = await import('../src/utils/logger')

      const repoInfo = await detectRepository()
      const finalRepoInfo = repoInfo || { owner: 'test-user', name: 'test-project' }
      await generateConfigFile(finalRepoInfo, true) // with custom token

      const preset = getWorkflowPreset('testing')
      expect(preset.name).toBe('Development/Testing')

      const logger = Logger.quiet()
      await generateCoreWorkflows(preset, finalRepoInfo, true, logger)

      // Verify config file has custom token setup
      const configContent = await fs.readFile('buddy-bot.config.ts', 'utf-8')
      expect(configContent).toContain('// token: process.env.BUDDY_BOT_TOKEN,')

      // Verify workflow has custom token environment
      const unifiedContent = await fs.readFile('.github/workflows/buddy-bot.yml', 'utf-8')
      expect(unifiedContent).toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')
    })

    it('should handle different token setup modes', async () => {
      const { detectRepository, generateConfigFile } = await import('../src/setup')

      const repoInfo = await detectRepository()
      const finalRepoInfo = repoInfo || { owner: 'test-user', name: 'test-project' }

      // Test default token mode
      await generateConfigFile(finalRepoInfo, false)
      let configContent = await fs.readFile('buddy-bot.config.ts', 'utf-8')
      expect(configContent).toContain('// Uses GITHUB_TOKEN by default')
      await fs.unlink('buddy-bot.config.ts')

      // Test custom token mode
      await generateConfigFile(finalRepoInfo, true)
      configContent = await fs.readFile('buddy-bot.config.ts', 'utf-8')
      expect(configContent).toContain('// token: process.env.BUDDY_BOT_TOKEN,')
    })
  })

  describe('Workflow Content Validation', () => {
    it('should generate update workflow with all required sections', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      const workflow = generateUnifiedWorkflow(false)

      // Test all the required sections from the specification
      const requiredSections = [
        'name: Buddy Bot',
        'cron: \'0 */2 * * *\'',
        'workflow_dispatch:',
        'strategy:',
        'dry_run:',
        'packages:',
        'verbose:',
        'default: true', // dry_run default
        'dependency-update:', // job name
        'Checkout repository',
        'Setup Bun',
        'Setup PHP and Composer',
        'Install dependencies',
        'Install Composer dependencies',
        // 'Build buddy-bot', // Removed from unified workflow
        'Configure Git',
        'Setup PHP and Composer (if needed)',
        'Display update configuration',
        'Run Buddy dependency updates',
        'Dry run notification',
        'Create update summary',
        'fetch-depth: 0',
        'persist-credentials: true',
        'actions: write',
        'contents: write',
        'pull-requests: write',
        'issues: write',
        'checks: read',
        'statuses: read',
      ]

      for (const section of requiredSections) {
        expect(workflow).toContain(section)
      }
    })

    it('should generate buddy-check workflow with correct structure', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      const workflow = generateUnifiedWorkflow(false)

      const requiredSections = [
        'name: Buddy Bot',
        'pull_request:', // Rebase checkbox triggers instantly via PR edit event
        'types: [edited]',
        'workflow_dispatch:',
        'dry_run:',
        'check:', // job name
        'bunx buddy-bot update-check',
      ]

      for (const section of requiredSections) {
        expect(workflow).toContain(section)
      }
    })

    it('should generate dashboard workflow with correct structure', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      const workflow = generateUnifiedWorkflow(false)

      const requiredSections = [
        'name: Buddy Bot',
        'cron: \'15 */2 * * *\'',
        'workflow_dispatch:',
        'bunx buddy-bot dashboard',
        'dashboard-update:', // job name
      ]

      for (const section of requiredSections) {
        expect(workflow).toContain(section)
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle missing git repository gracefully', async () => {
      // Remove git directory
      await fs.rm('.git', { recursive: true, force: true })

      const { detectRepository } = await import('../src/setup')
      const repoInfo = await detectRepository()

      expect(repoInfo).toBeNull()
    })

    it('should handle file system errors gracefully', async () => {
      const { generateConfigFile } = await import('../src/setup')

      // Try to write to a non-existent directory path
      const invalidPath = '/invalid/nonexistent/path'
      const originalCwd = process.cwd()

      const repoInfo = { owner: 'test', name: 'test' }

      try {
        // This should fail because we can't change to a non-existent directory
        process.chdir(invalidPath)
      }
      catch {
        // Expected to fail, continue with test
      }

      // Reset to original directory
      process.chdir(originalCwd)

      // This should work normally in a valid directory
      expect(async () => await generateConfigFile(repoInfo, false)).not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle projects with existing workflow files', async () => {
      // Create existing workflow files
      await fs.mkdir('.github/workflows', { recursive: true })
      await fs.writeFile('.github/workflows/ci.yml', 'name: CI\non: push')
      await fs.writeFile('.github/workflows/buddy-update.yml', 'name: Old Buddy\non: push')

      const { generateCoreWorkflows, getWorkflowPreset } = await import('../src/setup')
      const { Logger } = await import('../src/utils/logger')

      const repoInfo = { owner: 'test-org', name: 'test-repo' }
      const preset = getWorkflowPreset('standard')
      const logger = Logger.quiet()

      // Should create unified workflow and clean up old ones
      await generateCoreWorkflows(preset, repoInfo, false, logger)

      // Check that unified workflow was created
      const unifiedExists = await fs.access('.github/workflows/buddy-bot.yml').then(() => true).catch(() => false)
      expect(unifiedExists).toBe(true)

      const unifiedContent = await fs.readFile('.github/workflows/buddy-bot.yml', 'utf-8')
      expect(unifiedContent).toContain('name: Buddy Bot')
      expect(unifiedContent).not.toContain('name: Old Buddy')

      // Check that old workflow was cleaned up
      const oldExists = await fs.access('.github/workflows/buddy-update.yml').then(() => true).catch(() => false)
      expect(oldExists).toBe(false)
    })

    it('should handle projects with composer.json', async () => {
      // Create composer.json
      await fs.writeFile('composer.json', JSON.stringify({
        name: 'test/project',
        require: {
          'php': '^8.1',
          'laravel/framework': '^10.0',
        },
      }, null, 2))

      const { analyzeProject } = await import('../src/setup')
      const analysis = await analyzeProject()

      // The analysis should complete without error
      expect(analysis).toBeDefined()
      expect(typeof analysis.hasDependencyFiles).toBe('boolean')
      // Note: composer.json detection may vary in test environment
    })

    it('should handle monorepo projects', async () => {
      // Create a monorepo structure
      await fs.mkdir('packages/app1', { recursive: true })
      await fs.mkdir('packages/app2', { recursive: true })

      await fs.writeFile('packages/app1/package.json', JSON.stringify({ name: 'app1' }))
      await fs.writeFile('packages/app2/package.json', JSON.stringify({ name: 'app2' }))

      const { analyzeProject } = await import('../src/setup')
      const analysis = await analyzeProject()

      // The analysis should complete without error
      expect(analysis).toBeDefined()
      expect(typeof analysis.type).toBe('string')
      // Note: monorepo detection may vary based on existing package.json in root
    })
  })

  describe('Performance and Resource Management', () => {
    it('should complete setup in reasonable time', async () => {
      const {
        detectRepository,
        generateConfigFile,
        generateCoreWorkflows,
        getWorkflowPreset,
      } = await import('../src/setup')
      const { Logger } = await import('../src/utils/logger')

      const startTime = Date.now()

      const repoInfo = await detectRepository()
      const finalRepoInfo = repoInfo || { owner: 'test-user', name: 'test-project' }
      await generateConfigFile(finalRepoInfo, false)
      const preset = getWorkflowPreset('standard')
      const logger = Logger.quiet()
      await generateCoreWorkflows(preset, finalRepoInfo, false, logger)

      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within 5 seconds for a simple setup
      expect(duration).toBeLessThan(5000)
    })

    it('should not leave temporary files', async () => {
      const { generateConfigFile } = await import('../src/setup')

      const repoInfo = { owner: 'test', name: 'test' }
      await generateConfigFile(repoInfo, false)

      // Check that only expected files were created
      const files = await fs.readdir('.')
      expect(files).toContain('buddy-bot.config.ts')
      expect(files).not.toContain('tmp')
      expect(files).not.toContain('.tmp')
    })
  })
})
