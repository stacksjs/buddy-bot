import type { SetupContext, SetupPlugin } from '../src/setup'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { PluginManager } from '../src/setup'

describe('Integration Ecosystem & Plugin Architecture', () => {
  let pluginManager: PluginManager
  let mockContext: SetupContext

  beforeEach(() => {
    pluginManager = new PluginManager()
    mockContext = {
      step: 'setup_complete',
      progress: {
        currentStep: 8,
        totalSteps: 10,
        stepName: 'Complete',
        completed: ['step1', 'step2'],
        canResume: true,
        startTime: new Date(),
      },
      config: { test: true },
      repository: { owner: 'test-org', name: 'test-repo' },
      analysis: {
        type: 'application',
        packageManager: 'bun',
        hasLockFile: true,
        hasDependencyFiles: false,
        hasGitHubActions: true,
        recommendedPreset: 'standard',
        recommendations: [],
      },
      plugins: [],
    }

    // Clean up test environment variables
    delete process.env.SLACK_WEBHOOK_URL
    delete process.env.DISCORD_WEBHOOK_URL
    delete process.env.JIRA_API_TOKEN
    delete process.env.JIRA_BASE_URL
    delete process.env.JIRA_PROJECT_KEY
  })

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync('.buddy')) {
      fs.rmSync('.buddy', { recursive: true, force: true })
    }

    // Clean environment variables
    delete process.env.SLACK_WEBHOOK_URL
    delete process.env.DISCORD_WEBHOOK_URL
    delete process.env.JIRA_API_TOKEN
    delete process.env.JIRA_BASE_URL
    delete process.env.JIRA_PROJECT_KEY
  })

  describe('Plugin Discovery', () => {
    it('should discover no plugins when no integrations are configured', async () => {
      const plugins = await pluginManager.discoverPlugins()

      expect(plugins).toHaveLength(0)
    })

    it('should discover Slack plugin when webhook URL is configured', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test'

      const plugins = await pluginManager.discoverPlugins()

      expect(plugins).toHaveLength(1)
      expect(plugins[0].name).toBe('slack-integration')
      expect(plugins[0].version).toBe('1.0.0')
      expect(plugins[0].enabled).toBe(true)
      expect(plugins[0].triggers).toHaveLength(2)
      expect(plugins[0].hooks).toHaveLength(1)
      expect(plugins[0].configuration.webhook_url).toBe('https://hooks.slack.com/test')
    })

    it('should discover Discord plugin when webhook URL is configured', async () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test'

      const plugins = await pluginManager.discoverPlugins()

      expect(plugins).toHaveLength(1)
      expect(plugins[0].name).toBe('discord-integration')
      expect(plugins[0].version).toBe('1.0.0')
      expect(plugins[0].triggers).toHaveLength(1)
      expect(plugins[0].triggers[0].event).toBe('setup_complete')
    })

    it('should discover Jira plugin when API token is configured', async () => {
      process.env.JIRA_API_TOKEN = 'test-token'
      process.env.JIRA_BASE_URL = 'https://test.atlassian.net'

      const plugins = await pluginManager.discoverPlugins()

      expect(plugins).toHaveLength(1)
      expect(plugins[0].name).toBe('jira-integration')
      expect(plugins[0].configuration.api_token).toBe('test-token')
      expect(plugins[0].configuration.base_url).toBe('https://test.atlassian.net')
    })

    it('should discover multiple plugins when multiple integrations are configured', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test'
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test'
      process.env.JIRA_API_TOKEN = 'test-token'
      process.env.JIRA_BASE_URL = 'https://test.atlassian.net'

      const plugins = await pluginManager.discoverPlugins()

      expect(plugins).toHaveLength(3)
      const pluginNames = plugins.map(p => p.name)
      expect(pluginNames).toContain('slack-integration')
      expect(pluginNames).toContain('discord-integration')
      expect(pluginNames).toContain('jira-integration')
    })

    it('should discover plugins from file-based configuration', async () => {
      // Create .buddy/slack-webhook file
      fs.mkdirSync('.buddy', { recursive: true })
      fs.writeFileSync('.buddy/slack-webhook', 'https://hooks.slack.com/services/test')

      const plugins = await pluginManager.discoverPlugins()

      expect(plugins).toHaveLength(1)
      expect(plugins[0].name).toBe('slack-integration')
    })

    it('should load custom plugins from .buddy/plugins directory', async () => {
      // Create custom plugin configuration
      fs.mkdirSync('.buddy/plugins', { recursive: true })
      const customPlugin = {
        name: 'custom-integration',
        version: '2.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'custom-hook',
            priority: 15,
            async: false,
            handler() {
              // eslint-disable-next-line no-console
              console.log('Custom hook executed')
            },
          },
        ],
        configuration: { custom_setting: 'value' },
      }

      fs.writeFileSync(
        path.join('.buddy/plugins', 'custom.json'),
        JSON.stringify(customPlugin),
      )

      const plugins = await pluginManager.discoverPlugins()

      expect(plugins).toHaveLength(1)
      expect(plugins[0].name).toBe('custom-integration')
      expect(plugins[0].version).toBe('2.0.0')
    })

    it('should handle malformed custom plugin files gracefully', async () => {
      fs.mkdirSync('.buddy/plugins', { recursive: true })
      fs.writeFileSync(path.join('.buddy/plugins', 'invalid.json'), 'invalid json{')

      // Should not throw, just log warning
      const plugins = await pluginManager.discoverPlugins()
      expect(plugins).toHaveLength(0)
    })
  })

  describe('Plugin Loading', () => {
    it('should load plugins successfully', async () => {
      const mockPlugin: SetupPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'test-hook',
            priority: 10,
            async: false,
            handler: () => {},
          },
        ],
        configuration: {},
      }

      await pluginManager.loadPlugin(mockPlugin)

      // Plugin should be loaded internally (private property, so we test indirectly)
      expect(true).toBe(true) // Plugin loading doesn't throw
    })

    it('should load multiple plugins', async () => {
      const plugin1: SetupPlugin = {
        name: 'plugin-1',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [{ name: 'hook-1', priority: 10, async: false, handler: () => {} }],
        configuration: {},
      }

      const plugin2: SetupPlugin = {
        name: 'plugin-2',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'validation_error' }],
        hooks: [{ name: 'hook-2', priority: 5, async: true, handler: async () => {} }],
        configuration: {},
      }

      await pluginManager.loadPlugin(plugin1)
      await pluginManager.loadPlugin(plugin2)

      expect(true).toBe(true) // Both plugins loaded successfully
    })
  })

  describe('Hook Execution', () => {
    it('should execute plugin hooks when context is set', async () => {
      let hookExecuted = false

      const mockPlugin: SetupPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'test-hook',
            priority: 10,
            async: false,
            handler: (context: SetupContext) => {
              hookExecuted = true
              expect(context.step).toBe('setup_complete')
            },
          },
        ],
        configuration: {},
      }

      await pluginManager.loadPlugin(mockPlugin)
      pluginManager.setContext(mockContext)
      await pluginManager.executePluginHooks({ event: 'setup_complete' })

      expect(hookExecuted).toBe(true)
    })

    it('should execute hooks in priority order', async () => {
      const executionOrder: number[] = []

      const plugin1: SetupPlugin = {
        name: 'plugin-1',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'low-priority-hook',
            priority: 5,
            async: false,
            handler: () => { executionOrder.push(5) },
          },
        ],
        configuration: {},
      }

      const plugin2: SetupPlugin = {
        name: 'plugin-2',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'high-priority-hook',
            priority: 15,
            async: false,
            handler: () => { executionOrder.push(15) },
          },
        ],
        configuration: {},
      }

      await pluginManager.loadPlugin(plugin1)
      await pluginManager.loadPlugin(plugin2)
      pluginManager.setContext(mockContext)
      await pluginManager.executePluginHooks({ event: 'setup_complete' })

      expect(executionOrder).toEqual([15, 5]) // Higher priority first
    })

    it('should handle async hooks correctly', async () => {
      let asyncHookCompleted = false

      const mockPlugin: SetupPlugin = {
        name: 'async-plugin',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'async-hook',
            priority: 10,
            async: true,
            handler: async (_context: SetupContext) => {
              await new Promise(resolve => setTimeout(resolve, 10))
              asyncHookCompleted = true
            },
          },
        ],
        configuration: {},
      }

      await pluginManager.loadPlugin(mockPlugin)
      pluginManager.setContext(mockContext)
      await pluginManager.executePluginHooks({ event: 'setup_complete' })

      expect(asyncHookCompleted).toBe(true)
    })

    it('should handle hook errors gracefully', async () => {
      const mockPlugin: SetupPlugin = {
        name: 'failing-plugin',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'failing-hook',
            priority: 10,
            async: false,
            handler: () => {
              throw new Error('Hook failed')
            },
          },
        ],
        configuration: {},
      }

      await pluginManager.loadPlugin(mockPlugin)
      pluginManager.setContext(mockContext)

      // Should not throw, just log error
      await expect(async () => {
        await pluginManager.executePluginHooks({ event: 'setup_complete' })
      }).not.toThrow()
    })

    it('should only execute hooks for enabled plugins', async () => {
      let hookExecuted = false

      const disabledPlugin: SetupPlugin = {
        name: 'disabled-plugin',
        version: '1.0.0',
        enabled: false,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'disabled-hook',
            priority: 10,
            async: false,
            handler: () => { hookExecuted = true },
          },
        ],
        configuration: {},
      }

      await pluginManager.loadPlugin(disabledPlugin)
      pluginManager.setContext(mockContext)
      await pluginManager.executePluginHooks({ event: 'setup_complete' })

      expect(hookExecuted).toBe(false)
    })

    it('should only execute hooks matching the trigger event', async () => {
      let hookExecuted = false

      const mockPlugin: SetupPlugin = {
        name: 'specific-trigger-plugin',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'validation_error' }], // Different event
        hooks: [
          {
            name: 'specific-hook',
            priority: 10,
            async: false,
            handler: () => { hookExecuted = true },
          },
        ],
        configuration: {},
      }

      await pluginManager.loadPlugin(mockPlugin)
      pluginManager.setContext(mockContext)
      await pluginManager.executePluginHooks({ event: 'setup_complete' })

      expect(hookExecuted).toBe(false)
    })

    it('should not execute hooks when no context is set', async () => {
      let hookExecuted = false

      const mockPlugin: SetupPlugin = {
        name: 'no-context-plugin',
        version: '1.0.0',
        enabled: true,
        triggers: [{ event: 'setup_complete' }],
        hooks: [
          {
            name: 'no-context-hook',
            priority: 10,
            async: false,
            handler: () => { hookExecuted = true },
          },
        ],
        configuration: {},
      }

      await pluginManager.loadPlugin(mockPlugin)
      // Don't set context
      await pluginManager.executePluginHooks({ event: 'setup_complete' })

      expect(hookExecuted).toBe(false)
    })
  })

  describe('Built-in Integrations', () => {
    it('should create Slack plugin with correct configuration', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test'

      const plugins = await pluginManager.discoverPlugins()
      const slackPlugin = plugins.find(p => p.name === 'slack-integration')

      expect(slackPlugin).toBeDefined()
      expect(slackPlugin!.triggers).toEqual([
        { event: 'setup_complete' },
        { event: 'validation_error' },
      ])
      expect(slackPlugin!.hooks).toHaveLength(1)
      expect(slackPlugin!.hooks[0].name).toBe('notify-slack')
      expect(slackPlugin!.hooks[0].priority).toBe(10)
      expect(slackPlugin!.configuration.webhook_url).toBe('https://hooks.slack.com/test')
      expect(slackPlugin!.configuration.channel).toBe('#buddy-bot')
    })

    it('should create Discord plugin with correct configuration', async () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test'

      const plugins = await pluginManager.discoverPlugins()
      const discordPlugin = plugins.find(p => p.name === 'discord-integration')

      expect(discordPlugin).toBeDefined()
      expect(discordPlugin!.triggers).toEqual([{ event: 'setup_complete' }])
      expect(discordPlugin!.hooks).toHaveLength(1)
      expect(discordPlugin!.hooks[0].name).toBe('notify-discord')
      expect(discordPlugin!.hooks[0].priority).toBe(8)
      expect(discordPlugin!.configuration.webhook_url).toBe('https://discord.com/api/webhooks/test')
    })

    it('should create Jira plugin with correct configuration', async () => {
      process.env.JIRA_API_TOKEN = 'test-token'
      process.env.JIRA_BASE_URL = 'https://test.atlassian.net'
      process.env.JIRA_PROJECT_KEY = 'TEST'

      const plugins = await pluginManager.discoverPlugins()
      const jiraPlugin = plugins.find(p => p.name === 'jira-integration')

      expect(jiraPlugin).toBeDefined()
      expect(jiraPlugin!.triggers).toEqual([{ event: 'setup_complete' }])
      expect(jiraPlugin!.hooks).toHaveLength(1)
      expect(jiraPlugin!.hooks[0].name).toBe('create-jira-ticket')
      expect(jiraPlugin!.hooks[0].priority).toBe(5)
      expect(jiraPlugin!.configuration.api_token).toBe('test-token')
      expect(jiraPlugin!.configuration.base_url).toBe('https://test.atlassian.net')
      expect(jiraPlugin!.configuration.project_key).toBe('TEST')
    })

    it('should use default project key when not specified', async () => {
      process.env.JIRA_API_TOKEN = 'test-token'
      process.env.JIRA_BASE_URL = 'https://test.atlassian.net'

      const plugins = await pluginManager.discoverPlugins()
      const jiraPlugin = plugins.find(p => p.name === 'jira-integration')

      expect(jiraPlugin!.configuration.project_key).toBe('BUDDY')
    })
  })
})
