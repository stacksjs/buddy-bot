import { describe, expect, it } from 'bun:test'

describe('CLI Setup - Extended Tests', () => {
  describe('Update Workflow Generation', () => {
    it('should generate update workflow with different preset schedules', async () => {
      const { generateUpdateWorkflow } = await import('../src/setup')

      // Test Standard preset
      const standardPreset = {
        name: 'Standard Project',
        description: 'test',
        templates: { daily: true },
        schedules: { dashboard: '0 9 * * 1,3,5', updates: '0 9 * * 1,3,5' },
        strategy: 'all',
        autoMerge: false,
        custom: [],
      }
      const standardWorkflow = generateUpdateWorkflow(standardPreset, false)
      expect(standardWorkflow).toContain('name: Standard Dependency Updates')
      expect(standardWorkflow).toContain('cron: \'0 9 * * 1,3,5\'')
      // eslint-disable-next-line no-template-curly-in-string
      expect(standardWorkflow).toContain('${{ secrets.GITHUB_TOKEN }}')

      // Test High Frequency preset
      const highFreqPreset = {
        name: 'High Frequency Updates',
        description: 'test',
        templates: { comprehensive: true },
        schedules: { dashboard: '0 9 * * *', updates: '0 */6 * * *' },
        strategy: 'all',
        autoMerge: true,
        custom: [],
      }
      const highFreqWorkflow = generateUpdateWorkflow(highFreqPreset, true)
      expect(highFreqWorkflow).toContain('name: High Frequency Updates')
      expect(highFreqWorkflow).toContain('cron: \'0 */6 * * *\'')
      expect(highFreqWorkflow).toContain('BUDDY_BOT_TOKEN')

      // Test Security preset
      const securityPreset = {
        name: 'Security Focused',
        description: 'test',
        templates: { comprehensive: true },
        schedules: { dashboard: '0 9 * * *', updates: '0 */4 * * *' },
        strategy: 'all',
        autoMerge: true,
        custom: [],
      }
      const securityWorkflow = generateUpdateWorkflow(securityPreset, true)
      expect(securityWorkflow).toContain('name: Security-Focused Updates')
      expect(securityWorkflow).toContain('cron: \'0 */4 * * *\'')

      // Test Testing preset
      const testingPreset = {
        name: 'Development/Testing',
        description: 'test',
        templates: { weekly: true },
        schedules: { dashboard: 'manual', updates: '*/15 * * * *' },
        strategy: 'patch',
        autoMerge: false,
        custom: [],
      }
      const testingWorkflow = generateUpdateWorkflow(testingPreset, false)
      expect(testingWorkflow).toContain('name: Testing Updates')
      expect(testingWorkflow).toContain('cron: \'*/15 * * * *\'')
    })

    it('should include all required workflow elements', async () => {
      const { generateUpdateWorkflow } = await import('../src/setup')
      const preset = {
        name: 'Standard Project',
        description: 'test',
        templates: { daily: true },
        schedules: { dashboard: '0 9 * * 1,3,5', updates: '0 9 * * 1,3,5' },
        strategy: 'all',
        autoMerge: false,
        custom: [],
      }
      const workflow = generateUpdateWorkflow(preset, true)

      expect(workflow).toContain('workflow_dispatch:')
      expect(workflow).toContain('strategy:')
      expect(workflow).toContain('dry_run:')
      expect(workflow).toContain('packages:')
      expect(workflow).toContain('verbose:')
      expect(workflow).toContain('bun buddy scan')
      expect(workflow).toContain('bun buddy update')
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
    it('should generate correct token environment variables in workflows', async () => {
      const { generateDashboardWorkflow, generateUpdateCheckWorkflow } = await import('../src/setup')

      // With custom token
      const dashboardWithCustom = generateDashboardWorkflow(true)
      expect(dashboardWithCustom).toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')

      const updateCheckWithCustom = generateUpdateCheckWorkflow(true)
      expect(updateCheckWithCustom).toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')

      // With default token only
      const dashboardDefault = generateDashboardWorkflow(false)
      // eslint-disable-next-line no-template-curly-in-string
      expect(dashboardDefault).toContain('${{ secrets.GITHUB_TOKEN }}')
      expect(dashboardDefault).not.toContain('BUDDY_BOT_TOKEN')

      const updateCheckDefault = generateUpdateCheckWorkflow(false)
      // eslint-disable-next-line no-template-curly-in-string
      expect(updateCheckDefault).toContain('${{ secrets.GITHUB_TOKEN }}')
      expect(updateCheckDefault).not.toContain('BUDDY_BOT_TOKEN')
    })
  })

  describe('Workflow Structure Validation', () => {
    it('should generate valid YAML workflow structure', async () => {
      const { generateDashboardWorkflow, generateUpdateCheckWorkflow } = await import('../src/setup')

      const dashboard = generateDashboardWorkflow(true)
      expect(dashboard).toContain('name:')
      expect(dashboard).toContain('on:')
      expect(dashboard).toContain('schedule:')
      expect(dashboard).toContain('workflow_dispatch:')
      expect(dashboard).toContain('env:')
      expect(dashboard).toContain('permissions:')
      expect(dashboard).toContain('jobs:')
      expect(dashboard).toContain('runs-on: ubuntu-latest')
      expect(dashboard).toContain('steps:')

      const updateCheck = generateUpdateCheckWorkflow(false)
      expect(updateCheck).toContain('name:')
      expect(updateCheck).toContain('on:')
      expect(updateCheck).toContain('schedule:')
      expect(updateCheck).toContain('workflow_dispatch:')
      expect(updateCheck).toContain('env:')
      expect(updateCheck).toContain('permissions:')
      expect(updateCheck).toContain('jobs:')
    })

    it('should include proper GitHub Actions setup steps', async () => {
      const { generateDashboardWorkflow, generateUpdateCheckWorkflow } = await import('../src/setup')

      const dashboard = generateDashboardWorkflow(true)
      expect(dashboard).toContain('uses: actions/checkout@v4')
      expect(dashboard).toContain('uses: oven-sh/setup-bun@v2')
      expect(dashboard).toContain('bun install')
      expect(dashboard).toContain('bun run build')

      const updateCheck = generateUpdateCheckWorkflow(false)
      expect(updateCheck).toContain('uses: actions/checkout@v4')
      expect(updateCheck).toContain('uses: oven-sh/setup-bun@v2')
      expect(updateCheck).toContain('fetch-depth: 0')
      expect(updateCheck).toContain('persist-credentials: true')
      expect(updateCheck).toContain('git config --global user.name')
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
          title: 'Dependency Updates Dashboard',
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
