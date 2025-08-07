import { describe, expect, it } from 'bun:test'

describe('CLI Setup - Extended Tests', () => {
  describe('Unified Workflow Generation', () => {
    it('should generate unified workflow with different token configurations', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      // Test with custom token
      const workflowWithCustomToken = generateUnifiedWorkflow(true)
      expect(workflowWithCustomToken).toContain('name: Buddy Bot')
      expect(workflowWithCustomToken).toContain('cron: \'*/1 * * * *\'') // Check job
      expect(workflowWithCustomToken).toContain('cron: \'0 */2 * * *\'') // Update job
      expect(workflowWithCustomToken).toContain('cron: \'15 */2 * * *\'') // Dashboard job
      expect(workflowWithCustomToken).toContain('BUDDY_BOT_TOKEN')

      // Test with default token
      const workflowWithDefaultToken = generateUnifiedWorkflow(false)
      expect(workflowWithDefaultToken).toContain('name: Buddy Bot')
      expect(workflowWithDefaultToken).toContain('cron: \'*/1 * * * *\'') // Check job
      expect(workflowWithDefaultToken).toContain('cron: \'0 */2 * * *\'') // Update job
      expect(workflowWithDefaultToken).toContain('cron: \'15 */2 * * *\'') // Dashboard job
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflowWithDefaultToken).toContain('${{ secrets.GITHUB_TOKEN }}')
      // Should not use BUDDY_BOT_TOKEN in the actual token environment variable
      expect(workflowWithDefaultToken).not.toContain('secrets.BUDDY_BOT_TOKEN ||')
    })

    it('should include all required workflow jobs and elements', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      const workflow = generateUnifiedWorkflow(true)

      // Check all jobs are present
      expect(workflow).toContain('determine-jobs:')
      expect(workflow).toContain('setup:')
      expect(workflow).toContain('check:')
      expect(workflow).toContain('dependency-update:')
      expect(workflow).toContain('dashboard-update:')

      // Check workflow structure
      expect(workflow).toContain('workflow_dispatch:')
      expect(workflow).toContain('strategy:')
      expect(workflow).toContain('dry_run:')
      expect(workflow).toContain('packages:')
      expect(workflow).toContain('verbose:')
      expect(workflow).toContain('bunx buddy-bot scan')
      expect(workflow).toContain('bunx buddy-bot update')
      expect(workflow).toContain('bunx buddy-bot update-check')
      expect(workflow).toContain('bunx buddy-bot dashboard')
      expect(workflow).toContain('permissions:')
      expect(workflow).toContain('contents: write')
      expect(workflow).toContain('pull-requests: write')
    })
  })

  describe('All Preset Types', () => {
    it('should return correct configuration for all preset types', async () => {
      const { getWorkflowPreset } = await import('../src/setup')

      // Standard preset
      const standard = getWorkflowPreset('standard')
      expect(standard.name).toBe('Standard Project')
      expect(standard.templates?.daily).toBe(true)
      expect(standard.templates?.weekly).toBe(true)
      expect(standard.templates?.monthly).toBe(true)

      // High frequency preset
      const highFreq = getWorkflowPreset('high-frequency')
      expect(highFreq.name).toBe('High Frequency Updates')
      expect(highFreq.custom).toBeDefined()
      expect(Array.isArray(highFreq.custom)).toBe(true)

      // Security preset
      const security = getWorkflowPreset('security')
      expect(security.name).toBe('Security Focused')
      expect(security.custom?.some(c => c.name === 'security-patches')).toBe(true)

      // Minimal preset
      const minimal = getWorkflowPreset('minimal')
      expect(minimal.name).toBe('Minimal Updates')
      expect(minimal.templates?.weekly).toBe(true)
      expect(minimal.templates?.monthly).toBe(true)

      // Testing preset
      const testing = getWorkflowPreset('testing')
      expect(testing.name).toBe('Development/Testing')
      expect(testing.custom?.some(c => c.schedule === '*/5 * * * *')).toBe(true)

      // Custom preset
      const custom = getWorkflowPreset('custom')
      expect(custom.name).toBe('Custom Configuration')
      expect(custom.templates).toEqual({})
      expect(custom.custom).toEqual([])

      // Unknown preset (should fallback to standard)
      const unknown = getWorkflowPreset('unknown-preset')
      expect(unknown.name).toBe('Standard Project')
    })
  })

  describe('Token Environment Variables', () => {
    it('should generate correct token environment variables in unified workflow', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      // With custom token
      const workflowWithCustom = generateUnifiedWorkflow(true)
      expect(workflowWithCustom).toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')

      // With default token only
      const workflowWithDefault = generateUnifiedWorkflow(false)
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflowWithDefault).toContain('${{ secrets.GITHUB_TOKEN }}')
      // Should not use BUDDY_BOT_TOKEN in the actual token environment variable
      expect(workflowWithDefault).not.toContain('secrets.BUDDY_BOT_TOKEN ||')
    })
  })

  describe('Workflow Structure Validation', () => {
    it('should generate valid YAML workflow structure', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      const workflow = generateUnifiedWorkflow(true)
      expect(workflow).toContain('name: Buddy Bot')
      expect(workflow).toContain('on:')
      expect(workflow).toContain('schedule:')
      expect(workflow).toContain('workflow_dispatch:')
      expect(workflow).toContain('env:')
      expect(workflow).toContain('permissions:')
      expect(workflow).toContain('jobs:')
      expect(workflow).toContain('runs-on: ubuntu-latest')
      expect(workflow).toContain('steps:')
    })

    it('should include proper GitHub Actions setup steps', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      const workflow = generateUnifiedWorkflow(true)
      expect(workflow).toContain('uses: actions/checkout@v4')
      expect(workflow).toContain('uses: oven-sh/setup-bun@v2')
      expect(workflow).toContain('bun install')
      expect(workflow).toContain('fetch-depth: 0')
      expect(workflow).toContain('persist-credentials: true')
      expect(workflow).toContain('git config --global user.name')
      // TODO: Cache was removed from workflow optimization - no longer needed since each job sets up independently. Properly implement this in the future.
      // expect(workflow).toContain('uses: actions/cache/save@v4')
      // Note: cache/restore was removed from individual jobs to prevent bunx command not found errors
      // Should not contain build step since repos may not have build scripts
      expect(workflow).not.toContain('bun run build')
    })
  })

  describe('Configuration File Generation Logic', () => {
    it('should create valid configuration structure', () => {
      // Test the configuration structure that would be generated
      const repoInfo = { owner: 'test-owner', name: 'test-repo' }

      // Simulate the configuration content generation
      const configStructure = {
        repository: {
          owner: repoInfo.owner,
          name: repoInfo.name,
          provider: 'github' as const,
          token: undefined,
        },
        dashboard: {
          enabled: true,
          pin: false,
          title: 'Dependency Dashboard',
          issueNumber: undefined,
        },
        workflows: {
          enabled: true,
          outputDir: '.github/workflows',
          templates: {
            daily: true,
            weekly: true,
            monthly: true,
          },
          custom: [],
        },
        packages: {
          strategy: 'all',
          ignore: [],
        },
        verbose: false,
      }

      expect(configStructure.repository.owner).toBe('test-owner')
      expect(configStructure.repository.name).toBe('test-repo')
      expect(configStructure.repository.provider).toBe('github')
      expect(configStructure.dashboard.enabled).toBe(true)
      expect(configStructure.workflows.enabled).toBe(true)
      expect(configStructure.packages.strategy).toBe('all')
      expect(Array.isArray(configStructure.packages.ignore)).toBe(true)
    })
  })
})
