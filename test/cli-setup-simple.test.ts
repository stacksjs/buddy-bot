import { describe, expect, it } from 'bun:test'

describe('CLI Setup - Enhanced Functions', () => {
  describe('Unified Workflow Generation', () => {
    it('should generate unified workflow with custom token', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')
      const workflow = generateUnifiedWorkflow(true)

      expect(workflow).toContain('name: Buddy Bot')
      expect(workflow).toContain('cron: \'15 */2 * * *\'') // Updated dashboard schedule
      expect(workflow).toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')
      expect(workflow).toContain('bunx buddy-bot dashboard')
      expect(workflow).toContain('bunx buddy-bot update-check')
      expect(workflow).toContain('bunx buddy-bot update')
      expect(workflow).toContain('workflow_dispatch')
    })

    it('should generate unified workflow with default token', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')
      const workflow = generateUnifiedWorkflow(false)

      expect(workflow).toContain('name: Buddy Bot')
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflow).toContain('${{ secrets.GITHUB_TOKEN }}')
      // Should not use BUDDY_BOT_TOKEN in the actual token environment variable
      expect(workflow).not.toContain('secrets.BUDDY_BOT_TOKEN ||')
    })

    it('should include all three job types in unified workflow', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')
      const workflow = generateUnifiedWorkflow(true)

      expect(workflow).toContain('check:')
      expect(workflow).toContain('dependency-update:')
      expect(workflow).toContain('dashboard-update:')
      expect(workflow).toContain('cron: \'*/1 * * * *\'') // Check every minute
      expect(workflow).toContain('cron: \'0 */2 * * *\'') // Update every 2 hours
      expect(workflow).toContain('cron: \'15 */2 * * *\'') // Dashboard 15 mins after updates
      expect(workflow).toContain('bunx buddy-bot update-check')
      expect(workflow).toContain('bunx buddy-bot update')
      expect(workflow).toContain('bunx buddy-bot dashboard')
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

    it('should generate unified workflow with correct format', async () => {
      const { generateUnifiedWorkflow } = await import('../src/setup')

      const workflow = generateUnifiedWorkflow(false)

      expect(workflow).toContain('name: Buddy Bot')
      expect(workflow).toContain('cron: \'0 */2 * * *\'')
      expect(workflow).toContain('default: false') // dry_run default
      expect(workflow).toContain('dependency-update:') // job name
      expect(workflow).toContain('determine-jobs:') // job coordination
      expect(workflow).toContain('dashboard-update:') // dashboard job
    })
  })
})
