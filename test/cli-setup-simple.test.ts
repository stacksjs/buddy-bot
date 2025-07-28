import { describe, expect, it } from 'bun:test'

describe('CLI Setup - Enhanced Functions', () => {
  describe('Workflow Generation', () => {
    it('should generate dashboard workflow with custom token', async () => {
      const { generateDashboardWorkflow } = await import('../src/setup')
      const workflow = generateDashboardWorkflow(true)

      expect(workflow).toContain('name: Buddy Dashboard')
      expect(workflow).toContain('cron: \'0 9 * * 1,3,5\'')
      expect(workflow).toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')
      expect(workflow).toContain('bun buddy dashboard')
      expect(workflow).toContain('workflow_dispatch')
    })

    it('should generate dashboard workflow with default token', async () => {
      const { generateDashboardWorkflow } = await import('../src/setup')
      const workflow = generateDashboardWorkflow(false)

      expect(workflow).toContain('name: Buddy Dashboard')
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflow).toContain('${{ secrets.GITHUB_TOKEN }}')
      expect(workflow).not.toContain('BUDDY_BOT_TOKEN')
    })

    it('should generate update check workflow', async () => {
      const { generateUpdateCheckWorkflow } = await import('../src/setup')
      const workflow = generateUpdateCheckWorkflow(true)

      expect(workflow).toContain('name: Buddy Check')
      expect(workflow).toContain('cron: \'*/15 * * * *\'')
      expect(workflow).toContain('bun buddy update-check')
      expect(workflow).toContain('dry_run:')
    })
  })

  describe('Preset Configuration', () => {
    it('should return standard preset configuration', async () => {
      const { getWorkflowPreset } = await import('../src/setup')
      const preset = getWorkflowPreset('standard')

      expect(preset.name).toBe('Standard Project')
      expect(preset.description).toContain('Daily patch updates')
    })

    it('should return security preset configuration', async () => {
      const { getWorkflowPreset } = await import('../src/setup')
      const preset = getWorkflowPreset('security')

      expect(preset.name).toBe('Security Focused')
      expect(preset.description).toContain('security-first')
    })
  })
})
