/* eslint-disable no-console */
import type { Logger } from './utils/logger'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import prompts from 'prompts'

const execAsync = promisify(exec)

export interface RepositoryInfo {
  owner: string
  name: string
}

export interface WorkflowPreset {
  name: string
  description: string
  templates: {
    comprehensive?: boolean
    daily?: boolean
    weekly?: boolean
    monthly?: boolean
    docker?: boolean
    monorepo?: boolean
  }
  schedules: {
    dashboard: string
    updates: string
  }
  strategy: string
  autoMerge: boolean
  custom: Array<{
    name: string
    schedule: string
    strategy: string
    autoMerge: boolean
    autoMergeStrategy?: string
  }>
}

// New interfaces for enhanced functionality
export interface ValidationResult {
  success: boolean
  errors: string[]
  warnings: string[]
  suggestions: string[]
}

export interface ProjectAnalysis {
  type: 'library' | 'application' | 'monorepo' | 'unknown'
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'composer' | 'unknown'
  hasLockFile: boolean
  hasDependencyFiles: boolean
  hasGitHubActions: boolean
  recommendedPreset: string
  recommendations: string[]
}

export interface SetupProgress {
  currentStep: number
  totalSteps: number
  stepName: string
  completed: string[]
  failed?: string
  canResume: boolean
  startTime: Date
}

// Configuration Migration & Import System
export interface MigrationResult {
  source: 'renovate' | 'dependabot' | 'greenkeeper' | 'custom'
  configFound: boolean
  migratedSettings: Partial<any>
  warnings: string[]
  incompatibleFeatures: string[]
  confidence: 'high' | 'medium' | 'low'
}

export interface DetectedTool {
  name: string
  configFile: string
  version?: string
  active: boolean
}

// Integration Ecosystem & Plugin Architecture
export interface SetupPlugin {
  name: string
  version: string
  triggers: SetupTrigger[]
  hooks: SetupHook[]
  configuration: PluginConfig
  enabled: boolean
}

export interface SetupTrigger {
  event: 'pre_setup' | 'post_setup' | 'step_complete' | 'validation_error' | 'setup_complete'
  condition?: string
}

export interface SetupHook {
  name: string
  priority: number
  async: boolean
  handler: (context: SetupContext) => Promise<void> | void
}

export interface PluginConfig {
  [key: string]: any
}

export interface SetupContext {
  step: string
  progress: SetupProgress
  config: any
  repository: RepositoryInfo
  analysis: ProjectAnalysis
  plugins: SetupPlugin[]
}

export interface IntegrationPoint {
  tool: string
  endpoint: string
  authentication: AuthConfig
  dataMapping: Record<string, string>
  enabled: boolean
}

export interface AuthConfig {
  type: 'token' | 'oauth' | 'webhook' | 'api_key'
  credentials: Record<string, string>
}

// Configuration Migration Implementation
export class ConfigurationMigrator {
  async detectExistingTools(): Promise<DetectedTool[]> {
    const tools: DetectedTool[] = []

    // Check for Renovate
    if (fs.existsSync('renovate.json') || fs.existsSync('.renovaterc') || fs.existsSync('.renovaterc.json')) {
      tools.push({
        name: 'renovate',
        configFile: this.findRenovateConfig(),
        active: true,
      })
    }

    // Check for Dependabot
    if (fs.existsSync('.github/dependabot.yml') || fs.existsSync('.github/dependabot.yaml')) {
      tools.push({
        name: 'dependabot',
        configFile: fs.existsSync('.github/dependabot.yml') ? '.github/dependabot.yml' : '.github/dependabot.yaml',
        active: true,
      })
    }

    // Check for package.json renovate config
    if (fs.existsSync('package.json')) {
      try {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        if (packageJson.renovate) {
          tools.push({
            name: 'renovate',
            configFile: 'package.json',
            active: true,
          })
        }
      }
      catch {
        // Ignore package.json parsing errors
      }
    }

    return tools
  }

  private findRenovateConfig(): string {
    const renovateFiles = ['renovate.json', '.renovaterc', '.renovaterc.json', '.renovaterc.js']
    for (const file of renovateFiles) {
      if (fs.existsSync(file)) {
        return file
      }
    }
    return 'package.json'
  }

  async migrateFromRenovate(configPath: string): Promise<MigrationResult> {
    const result: MigrationResult = {
      source: 'renovate',
      configFound: false,
      migratedSettings: {},
      warnings: [],
      incompatibleFeatures: [],
      confidence: 'medium',
    }

    try {
      let renovateConfig: any = {}

      if (configPath === 'package.json') {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        renovateConfig = packageJson.renovate || {}
      }
      else {
        const configContent = fs.readFileSync(configPath, 'utf8')
        renovateConfig = JSON.parse(configContent)
      }

      result.configFound = true

      // Migrate schedule settings
      if (renovateConfig.schedule) {
        result.migratedSettings.schedule = this.convertRenovateSchedule(renovateConfig.schedule)
      }

      // Migrate package rules
      if (renovateConfig.packageRules) {
        result.migratedSettings.packages = this.convertRenovatePackageRules(renovateConfig.packageRules)
      }

      // Migrate ignore patterns
      if (renovateConfig.ignoreDeps) {
        result.migratedSettings.ignore = renovateConfig.ignoreDeps
      }

      // Migrate automerge settings
      if (renovateConfig.automerge !== undefined) {
        result.migratedSettings.autoMerge = {
          enabled: renovateConfig.automerge,
          strategy: renovateConfig.automergeStrategy || 'squash',
        }
      }

      // Migrate assignees/reviewers
      if (renovateConfig.assignees) {
        result.migratedSettings.assignees = renovateConfig.assignees
      }
      if (renovateConfig.reviewers) {
        result.migratedSettings.reviewers = renovateConfig.reviewers
      }

      // Check for incompatible features
      if (renovateConfig.extends) {
        result.incompatibleFeatures.push('extends: Renovate preset extensions not directly supported')
      }
      if (renovateConfig.regexManagers) {
        result.incompatibleFeatures.push('regexManagers: Custom regex managers not supported')
      }

      result.confidence = result.incompatibleFeatures.length > 1 ? 'low' : 'high'
    }
    catch (error) {
      result.warnings.push(`Failed to parse Renovate config: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    return result
  }

  async migrateFromDependabot(configPath: string): Promise<MigrationResult> {
    const result: MigrationResult = {
      source: 'dependabot',
      configFound: false,
      migratedSettings: {},
      warnings: [],
      incompatibleFeatures: [],
      confidence: 'medium',
    }

    try {
      const yamlContent = fs.readFileSync(configPath, 'utf8')

      // Basic YAML parsing (simplified)
      const lines = yamlContent.split('\n')
      let schedule = ''
      const ignore: string[] = []

      for (const line of lines) {
        const trimmed = line.trim()
        // Skip package-ecosystem lines as they don't affect migration logic
        if (trimmed.includes('interval:')) {
          const scheduleMatch = trimmed.match(/interval:\s*['"]*([^'"\s]+)['"]*/)
          if (scheduleMatch) {
            schedule = scheduleMatch[1]
          }
        }
        if (trimmed.includes('- dependency-name:')) {
          const depMatch = trimmed.match(/dependency-name:\s*['"]*([^'"\s]+)['"]*/)
          if (depMatch) {
            ignore.push(depMatch[1])
          }
        }
      }

      result.configFound = true

      // Convert Dependabot schedule to Buddy format
      if (schedule) {
        result.migratedSettings.schedule = this.convertDependabotSchedule(schedule)
      }

      if (ignore.length > 0) {
        result.migratedSettings.ignore = ignore
      }

      // Dependabot has limited configuration options
      result.warnings.push('Dependabot configuration is limited. Consider customizing Buddy Bot settings.')
    }
    catch (error) {
      result.warnings.push(`Failed to parse Dependabot config: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    return result
  }

  private convertRenovateSchedule(schedule: string[]): any {
    if (schedule.includes('every weekend')) {
      return { preset: 'minimal' }
    }
    if (schedule.includes('before 6am')) {
      return { preset: 'high-frequency' }
    }
    return { preset: 'standard' }
  }

  private convertRenovatePackageRules(packageRules: any[]): any {
    const groups: any[] = []
    const ignore: string[] = []

    for (const rule of packageRules) {
      if (rule.enabled === false && rule.matchPackageNames) {
        ignore.push(...rule.matchPackageNames)
      }
      if (rule.groupName && rule.matchPackagePatterns) {
        groups.push({
          name: rule.groupName,
          patterns: rule.matchPackagePatterns,
          strategy: rule.updateTypes?.includes('major') ? 'all' : 'minor',
        })
      }
    }

    return { groups, ignore }
  }

  private convertDependabotSchedule(interval: string): any {
    switch (interval) {
      case 'daily':
        return { preset: 'high-frequency' }
      case 'weekly':
        return { preset: 'standard' }
      case 'monthly':
        return { preset: 'minimal' }
      default:
        return { preset: 'standard' }
    }
  }

  async generateMigrationReport(results: MigrationResult[]): Promise<string> {
    let report = '📋 Configuration Migration Report\n\n'

    for (const result of results) {
      report += `## ${result.source.toUpperCase()} Migration\n`
      report += `- **Config Found**: ${result.configFound ? '✅ Yes' : '❌ No'}\n`
      report += `- **Confidence**: ${this.getConfidenceEmoji(result.confidence)} ${result.confidence}\n`

      if (Object.keys(result.migratedSettings).length > 0) {
        report += `- **Migrated Settings**: ${Object.keys(result.migratedSettings).join(', ')}\n`
      }

      if (result.warnings.length > 0) {
        report += `- **Warnings**: ${result.warnings.length}\n`
      }

      if (result.incompatibleFeatures.length > 0) {
        report += `- **Incompatible Features**: ${result.incompatibleFeatures.length}\n`
      }

      report += '\n'
    }

    return report
  }

  private getConfidenceEmoji(confidence: string): string {
    switch (confidence) {
      case 'high': return '🟢'
      case 'medium': return '🟡'
      case 'low': return '🔴'
      default: return '⚪'
    }
  }
}

// Plugin Architecture Implementation
export class PluginManager {
  private plugins: SetupPlugin[] = []
  private context: SetupContext | null = null

  async discoverPlugins(): Promise<SetupPlugin[]> {
    const discoveredPlugins: SetupPlugin[] = []

    // Check for built-in integrations
    if (await this.hasSlackWebhook()) {
      discoveredPlugins.push(this.createSlackPlugin())
    }

    if (await this.hasJiraIntegration()) {
      discoveredPlugins.push(this.createJiraPlugin())
    }

    if (await this.hasDiscordWebhook()) {
      discoveredPlugins.push(this.createDiscordPlugin())
    }

    // Check for custom plugins in .buddy/plugins/
    if (fs.existsSync('.buddy/plugins/')) {
      const customPlugins = await this.loadCustomPlugins()
      discoveredPlugins.push(...customPlugins)
    }

    return discoveredPlugins
  }

  async loadPlugin(plugin: SetupPlugin): Promise<void> {
    this.plugins.push(plugin)
    console.log(`🔌 Loaded plugin: ${plugin.name} v${plugin.version}`)
  }

  async executePluginHooks(trigger: SetupTrigger): Promise<void> {
    if (!this.context)
      return

    const applicablePlugins = this.plugins.filter(plugin =>
      plugin.enabled && plugin.triggers.some(t => t.event === trigger.event),
    )

    // Sort by priority
    const sortedHooks = applicablePlugins
      .flatMap(plugin => plugin.hooks)
      .sort((a, b) => b.priority - a.priority)

    for (const hook of sortedHooks) {
      try {
        if (hook.async) {
          await hook.handler(this.context)
        }
        else {
          hook.handler(this.context)
        }
        console.log(`✅ Executed hook: ${hook.name}`)
      }
      catch (error) {
        console.log(`❌ Hook failed: ${hook.name} - ${error instanceof Error ? error.message : 'Unknown error'}`)
        // Continue execution, don't rethrow
      }
    }
  }

  setContext(context: SetupContext): void {
    this.context = context
  }

  private async hasSlackWebhook(): Promise<boolean> {
    return process.env.SLACK_WEBHOOK_URL !== undefined
      || fs.existsSync('.buddy/slack-webhook')
  }

  private async hasJiraIntegration(): Promise<boolean> {
    return process.env.JIRA_API_TOKEN !== undefined
      || fs.existsSync('.buddy/jira-config.json')
  }

  private async hasDiscordWebhook(): Promise<boolean> {
    return process.env.DISCORD_WEBHOOK_URL !== undefined
      || fs.existsSync('.buddy/discord-webhook')
  }

  private createSlackPlugin(): SetupPlugin {
    return {
      name: 'slack-integration',
      version: '1.0.0',
      enabled: true,
      triggers: [
        { event: 'setup_complete' },
        { event: 'validation_error' },
      ],
      hooks: [
        {
          name: 'notify-slack',
          priority: 10,
          async: true,
          handler: async (context: SetupContext) => {
            await this.sendSlackNotification(context)
          },
        },
      ],
      configuration: {
        webhook_url: process.env.SLACK_WEBHOOK_URL || '',
        channel: '#buddy-bot',
        username: 'Buddy Bot',
      },
    }
  }

  private createJiraPlugin(): SetupPlugin {
    return {
      name: 'jira-integration',
      version: '1.0.0',
      enabled: true,
      triggers: [
        { event: 'setup_complete' },
      ],
      hooks: [
        {
          name: 'create-jira-ticket',
          priority: 5,
          async: true,
          handler: async (context: SetupContext) => {
            await this.createJiraTicket(context)
          },
        },
      ],
      configuration: {
        api_token: process.env.JIRA_API_TOKEN || '',
        base_url: process.env.JIRA_BASE_URL || '',
        project_key: process.env.JIRA_PROJECT_KEY || 'BUDDY',
      },
    }
  }

  private createDiscordPlugin(): SetupPlugin {
    return {
      name: 'discord-integration',
      version: '1.0.0',
      enabled: true,
      triggers: [
        { event: 'setup_complete' },
      ],
      hooks: [
        {
          name: 'notify-discord',
          priority: 8,
          async: true,
          handler: async (context: SetupContext) => {
            await this.sendDiscordNotification(context)
          },
        },
      ],
      configuration: {
        webhook_url: process.env.DISCORD_WEBHOOK_URL || '',
      },
    }
  }

  private async loadCustomPlugins(): Promise<SetupPlugin[]> {
    const plugins: SetupPlugin[] = []

    try {
      const pluginFiles = fs.readdirSync('.buddy/plugins/')
        .filter(file => file.endsWith('.json'))

      for (const file of pluginFiles) {
        try {
          const pluginConfig = JSON.parse(fs.readFileSync(path.join('.buddy/plugins/', file), 'utf8'))
          plugins.push(pluginConfig)
        }
        catch (error) {
          console.log(`⚠️  Failed to load plugin ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }
    }
    catch {
      // .buddy/plugins/ directory doesn't exist
    }

    return plugins
  }

  private async sendSlackNotification(context: SetupContext): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL
    if (!webhookUrl)
      return

    const message = {
      text: `🤖 Buddy Bot Setup Complete!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Buddy Bot Setup Complete*\n🔗 Repository: \`${context.repository.owner}/${context.repository.name}\`\n📊 Project Type: \`${context.analysis.type}\`\n⚙️ Package Manager: \`${context.analysis.packageManager}\``,
          },
        },
      ],
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      })

      if (response.ok) {
        console.log('✅ Slack notification sent successfully')
      }
      else {
        console.log('⚠️  Failed to send Slack notification')
      }
    }
    catch (error) {
      console.log(`❌ Slack notification error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async sendDiscordNotification(context: SetupContext): Promise<void> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL
    if (!webhookUrl)
      return

    const message = {
      embeds: [
        {
          title: '🤖 Buddy Bot Setup Complete!',
          color: 0x00FF00,
          fields: [
            { name: 'Repository', value: `${context.repository.owner}/${context.repository.name}`, inline: true },
            { name: 'Project Type', value: context.analysis.type, inline: true },
            { name: 'Package Manager', value: context.analysis.packageManager, inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      })

      if (response.ok) {
        console.log('✅ Discord notification sent successfully')
      }
      else {
        console.log('⚠️  Failed to send Discord notification')
      }
    }
    catch (error) {
      console.log(`❌ Discord notification error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async createJiraTicket(context: SetupContext): Promise<void> {
    const apiToken = process.env.JIRA_API_TOKEN
    const baseUrl = process.env.JIRA_BASE_URL
    const projectKey = process.env.JIRA_PROJECT_KEY || 'BUDDY'

    if (!apiToken || !baseUrl)
      return

    const ticket = {
      fields: {
        project: { key: projectKey },
        summary: `Buddy Bot Setup Complete - ${context.repository.owner}/${context.repository.name}`,
        description: `Buddy Bot has been successfully configured for repository ${context.repository.owner}/${context.repository.name}.\n\nProject Type: ${context.analysis.type}\nPackage Manager: ${context.analysis.packageManager}\n\nSetup completed at: ${new Date().toISOString()}`,
        issuetype: { name: 'Task' },
      },
    }

    try {
      const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify(ticket),
      })

      if (response.ok) {
        const result = await response.json() as { key: string }
        console.log(`✅ Jira ticket created: ${result.key}`)
      }
      else {
        console.log('⚠️  Failed to create Jira ticket')
      }
    }
    catch (error) {
      console.log(`❌ Jira integration error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}

// Pre-flight validation functions
export async function runPreflightChecks(): Promise<ValidationResult> {
  const result: ValidationResult = {
    success: true,
    errors: [],
    warnings: [],
    suggestions: [],
  }

  // Check if we're in a git repository
  try {
    await execAsync('git rev-parse --git-dir')
  }
  catch {
    result.success = false
    result.errors.push('Not in a git repository. Run "git init" first.')
    return result
  }

  // Check git configuration
  try {
    await execAsync('git config user.name')
    await execAsync('git config user.email')
  }
  catch {
    result.warnings.push('Git user configuration not found. Consider setting user.name and user.email.')
  }

  // Check for existing workflows
  const workflowDir = '.github/workflows'
  if (fs.existsSync(workflowDir)) {
    const existingWorkflows = fs.readdirSync(workflowDir)
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))

    if (existingWorkflows.length > 0) {
      result.warnings.push(`Found ${existingWorkflows.length} existing workflow(s). Some may conflict with Buddy Bot workflows.`)

      // Check for conflicting dependency management tools
      const conflictingFiles = existingWorkflows.filter(file =>
        file.includes('dependabot')
        || file.includes('renovate')
        || file.includes('dependency'),
      )

      if (conflictingFiles.length > 0) {
        result.warnings.push(`Potential conflicts detected with: ${conflictingFiles.join(', ')}`)
        result.suggestions.push('Consider disabling or removing existing dependency management workflows.')
      }
    }
  }

  // Check Node.js/Bun installation
  try {
    const { stdout } = await execAsync('bun --version')
    const version = stdout.trim()
    result.suggestions.push(`Using Bun v${version}`)
  }
  catch {
    try {
      const { stdout } = await execAsync('node --version')
      const version = stdout.trim()
      result.warnings.push(`Using Node.js ${version}. Consider using Bun for better performance.`)
    }
    catch {
      result.errors.push('Neither Bun nor Node.js found. Please install Bun.')
      result.success = false
    }
  }

  // Check GitHub CLI (optional but helpful)
  try {
    await execAsync('gh --version')
    result.suggestions.push('GitHub CLI detected. This can help with authentication.')
  }
  catch {
    result.suggestions.push('Install GitHub CLI (gh) for easier authentication setup.')
  }

  return result
}

export async function analyzeProject(): Promise<ProjectAnalysis> {
  const analysis: ProjectAnalysis = {
    type: 'unknown',
    packageManager: 'unknown',
    hasLockFile: false,
    hasDependencyFiles: false,
    hasGitHubActions: false,
    recommendedPreset: 'Standard Setup',
    recommendations: [],
  }

  // Detect package manager and project type
  if (fs.existsSync('package.json')) {
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))

      // Determine project type
      if (packageJson.workspaces || fs.existsSync('lerna.json') || fs.existsSync('nx.json')) {
        analysis.type = 'monorepo'
        analysis.recommendedPreset = 'High Frequency'
        analysis.recommendations.push('Monorepo detected. Consider grouping related packages.')
      }
      else if (packageJson.main || packageJson.module || packageJson.exports) {
        analysis.type = 'library'
        analysis.recommendedPreset = 'Security Focused'
        analysis.recommendations.push('Library project detected. Focus on security updates.')
      }
      else {
        analysis.type = 'application'
        analysis.recommendedPreset = 'Standard Setup'
      }

      // Check for scripts that indicate testing/CI requirements
      if (packageJson.scripts?.test || packageJson.scripts?.ci) {
        analysis.recommendations.push('Testing scripts found. Consider enabling dry-run mode initially.')
      }
    }
    catch {
      analysis.recommendations.push('package.json found but could not be parsed.')
    }
  }

  // Detect package manager
  if (fs.existsSync('bun.lockb')) {
    analysis.packageManager = 'bun'
    analysis.hasLockFile = true
    analysis.recommendations.push('Bun detected. Optimal performance expected.')
  }
  else if (fs.existsSync('pnpm-lock.yaml')) {
    analysis.packageManager = 'pnpm'
    analysis.hasLockFile = true
  }
  else if (fs.existsSync('yarn.lock')) {
    analysis.packageManager = 'yarn'
    analysis.hasLockFile = true
  }
  else if (fs.existsSync('package-lock.json')) {
    analysis.packageManager = 'npm'
    analysis.hasLockFile = true
  }
  else if (fs.existsSync('composer.json')) {
    analysis.packageManager = 'composer'
    analysis.hasLockFile = fs.existsSync('composer.lock')
  }

  // Check for dependency files (pkgx, Launchpad)
  const dependencyFiles = ['deps.yaml', 'deps.yml', 'dependencies.yaml', 'dependencies.yml', 'pkgx.yaml', 'pkgx.yml']
  analysis.hasDependencyFiles = dependencyFiles.some(file => fs.existsSync(file))

  if (analysis.hasDependencyFiles) {
    analysis.recommendations.push('Dependency files detected. Multi-format support enabled.')
  }

  // Check for Composer files
  const hasComposerJson = fs.existsSync('composer.json')
  const hasComposerLock = fs.existsSync('composer.lock')

  if (hasComposerJson) {
    analysis.recommendations.push('Composer detected. PHP package updates will be included.')
    if (!hasComposerLock) {
      analysis.recommendations.push('Consider running "composer install" to generate composer.lock for better dependency tracking.')
    }
  }

  // Check for existing GitHub Actions
  if (fs.existsSync('.github/workflows')) {
    const workflows = fs.readdirSync('.github/workflows')
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
    analysis.hasGitHubActions = workflows.length > 0

    if (analysis.hasGitHubActions) {
      analysis.recommendations.push(`${workflows.length} existing workflow(s) found. GitHub Actions updates will be included.`)
    }
  }

  // Adjust recommendations based on analysis
  if (analysis.type === 'monorepo') {
    analysis.recommendations.push('Consider using package grouping for related dependencies.')
  }

  if (!analysis.hasLockFile) {
    analysis.recommendations.push('No lock file detected. Consider using a package manager with lock files.')
  }

  return analysis
}

export function createProgressTracker(totalSteps: number): SetupProgress {
  return {
    currentStep: 0,
    totalSteps,
    stepName: 'Initializing',
    completed: [],
    canResume: true,
    startTime: new Date(),
  }
}

export function updateProgress(progress: SetupProgress, stepName: string, completed?: boolean): SetupProgress {
  if (completed && progress.stepName && !progress.completed.includes(progress.stepName)) {
    progress.completed.push(progress.stepName)
  }

  if (stepName !== progress.stepName) {
    progress.currentStep++
    progress.stepName = stepName
  }

  return progress
}

export function displayProgress(progress: SetupProgress): void {
  // Ensure currentStep doesn't exceed totalSteps to prevent negative percentages
  const currentStep = Math.min(progress.currentStep, progress.totalSteps)
  const percentage = Math.round((currentStep / progress.totalSteps) * 100)

  // Ensure the progress bar calculation is valid (0-20 range)
  const progressBlocks = Math.max(0, Math.min(20, Math.floor(percentage / 5)))
  const progressBar = '█'.repeat(progressBlocks) + '░'.repeat(20 - progressBlocks)

  console.log(`\n📊 Setup Progress: ${percentage}% [${progressBar}]`)
  console.log(`🔄 Current Step: ${progress.stepName} (${currentStep}/${progress.totalSteps})`)

  if (progress.completed.length > 0) {
    console.log(`✅ Completed: ${progress.completed.join(', ')}`)
  }
}

export async function detectRepository(): Promise<RepositoryInfo | null> {
  try {
    const { stdout } = await execAsync('git remote get-url origin')
    const remoteUrl = stdout.trim()

    // Parse GitHub URL (supports both HTTPS and SSH)
    const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+)(?:\.git)?/)
    if (match) {
      return { owner: match[1], name: match[2] }
    }
    return null
  }
  catch {
    return null
  }
}

export async function guideTokenCreation(repoInfo: RepositoryInfo): Promise<void> {
  console.log(`\n🔑 Personal Access Token Setup Guide:`)
  console.log(`\n📋 Step 1: Create the Token`)
  console.log(`1. Go to https://github.com/settings/tokens`)
  console.log(`2. Click "Generate new token (classic)"`)
  console.log(`3. Give it a descriptive name (e.g., "buddy-bot-${repoInfo.name}")`)
  console.log(`4. Set expiration (recommended: 90 days or custom)`)
  console.log(`5. Select required scopes:`)
  console.log(`   ✅ repo (Full control of private repositories)`)
  console.log(`   ✅ workflow (Update GitHub Action workflows)`)
  console.log(`6. Click "Generate token"`)
  console.log(`7. ⚠️  Copy the token immediately (you won't see it again!)`)

  console.log(`\n📋 Step 2: Configure the Secret`)
  console.log(`Choose one of these options:`)
  console.log(`\n🏢 Option A: Organization Secret (Recommended for multiple repos)`)
  console.log(`   - Go to: https://github.com/organizations/${repoInfo.owner}/settings/secrets/actions`)
  console.log(`   - Click "New organization secret"`)
  console.log(`   - Name: BUDDY_BOT_TOKEN`)
  console.log(`   - Value: your_generated_token`)
  console.log(`   - Repository access: Selected repositories or All repositories`)

  console.log(`\n📦 Option B: Repository Secret (For this repository only)`)
  console.log(`   - Go to: https://github.com/${repoInfo.owner}/${repoInfo.name}/settings/secrets/actions`)
  console.log(`   - Click "New repository secret"`)
  console.log(`   - Name: BUDDY_BOT_TOKEN`)
  console.log(`   - Value: your_generated_token`)
  console.log(`   - Click "Add secret"`)

  console.log(`\n💡 The workflows will automatically use BUDDY_BOT_TOKEN if available, otherwise fall back to GITHUB_TOKEN`)
}

export async function confirmTokenSetup(): Promise<{ hasCustomToken: boolean, needsGuide: boolean }> {
  console.log('\n🔑 GitHub Token Configuration:')
  console.log('Buddy Bot can work with:')
  console.log('  • Organization secrets (GITHUB_TOKEN or custom PAT)')
  console.log('  • Repository secrets (custom PAT)')
  console.log('  • Default GITHUB_TOKEN (limited permissions)')
  console.log('')

  const response = await prompts({
    type: 'select',
    name: 'tokenChoice',
    message: 'How would you like to configure GitHub authentication?',
    choices: [
      {
        title: 'Use organization/repository secrets',
        description: 'I have already configured PAT as an organization or repository secret',
        value: 'existing-secret',
      },
      {
        title: 'Set up a new Personal Access Token',
        description: 'Guide me through creating and configuring a new PAT',
        value: 'new-pat',
      },
      {
        title: 'Use default GITHUB_TOKEN only',
        description: 'Limited functionality - workflow updates won\'t work',
        value: 'default-token',
      },
    ],
    initial: 0,
  })

  // Handle user cancellation
  if (!response.tokenChoice) {
    console.log('Using default GITHUB_TOKEN (limited functionality)')
    return { hasCustomToken: false, needsGuide: false }
  }

  switch (response.tokenChoice) {
    case 'existing-secret':
      return { hasCustomToken: true, needsGuide: false }
    case 'new-pat':
      return { hasCustomToken: true, needsGuide: true }
    case 'default-token':
    default:
      return { hasCustomToken: false, needsGuide: false }
  }
}

export async function guideRepositorySettings(repoInfo: RepositoryInfo): Promise<void> {
  console.log(`\n🔧 To configure GitHub Actions permissions:`)
  console.log(`1. Go to your repository settings (https://github.com/${repoInfo.owner}/${repoInfo.name}/settings/actions)`)
  console.log(`2. Under "Workflow permissions":`)
  console.log(`   ✅ Select "Read and write permissions"`)
  console.log(`   ✅ Check "Allow GitHub Actions to create and approve pull requests"`)
  console.log(`3. Click "Save"`)
  console.log(`4. This allows Buddy Bot to create PRs and update issues.\n`)
}

export async function generateConfigFile(repoInfo: RepositoryInfo, hasCustomToken: boolean): Promise<void> {
  const configContent = `import type { BuddyBotConfig } from 'buddy-bot'

const config: BuddyBotConfig = {
  repository: {
    owner: '${repoInfo.owner}',
    name: '${repoInfo.name}',
    provider: 'github',
    ${hasCustomToken ? '// token: process.env.BUDDY_BOT_TOKEN,' : '// Uses GITHUB_TOKEN by default'}
  },
  dashboard: {
    enabled: true,
    title: 'Dependency Dashboard',
    // issueNumber: undefined, // Auto-generated
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
    ignore: [
      // Add packages to ignore here
      // Example: '@types/node', 'eslint'
    ],
    ignorePaths: [
      // Add file/directory paths to ignore using glob patterns
      // Example: 'packages/test-*/**', '**/*test-envs/**', 'apps/legacy/**'
    ],
  },
  verbose: false,
}

export default config
`

  const configPath = 'buddy-bot.config.ts'
  fs.writeFileSync(configPath, configContent)
  console.log(`✅ Created ${configPath} with your repository settings.`)
  console.log(`💡 You can edit this file to customize Buddy Bot's behavior.`)
  console.log(`🔧 The TypeScript config provides better IntelliSense and type safety.\n`)
}

/**
 * Generate PHP and Composer setup steps for workflows
 */
function generateComposerSetupSteps(): string {
  return `
      - name: Setup PHP and Composer (if needed)
        if: \${{ hashFiles('composer.json') != '' }}
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          tools: composer
          coverage: none

      - name: Install Composer dependencies (if needed)
        if: \${{ hashFiles('composer.json') != '' }}
        run: composer install --prefer-dist --optimize-autoloader
`
}

export function generateUnifiedWorkflow(hasCustomToken: boolean): string {
  const tokenEnv = hasCustomToken
    // eslint-disable-next-line no-template-curly-in-string
    ? '${{ secrets.BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN }}'
    // eslint-disable-next-line no-template-curly-in-string
    : '${{ secrets.GITHUB_TOKEN }}'

  return `name: Buddy Bot

on:
  schedule:
    # Check for rebase requests every minute
    - cron: '*/1 * * * *'
    # Update dependencies every 2 hours
    - cron: '0 */2 * * *'
    # Update dashboard 15 minutes after dependency updates (ensures updates are reflected)
    - cron: '15 */2 * * *'

  workflow_dispatch: # Manual trigger
    inputs:
      job:
        description: Which job to run
        required: false
        default: all
        type: choice
        options:
          - all
          - check
          - update
          - dashboard
      # Update job inputs
      strategy:
        description: Update strategy
        required: false
        default: patch
        type: choice
        options:
          - all
          - major
          - minor
          - patch
      packages:
        description: Specific packages (comma-separated)
        required: false
        type: string
      # Dashboard job inputs
      title:
        description: Custom dashboard title
        required: false
        type: string
      issue_number:
        description: Specific issue number to update
        required: false
        type: string
      # Common inputs
      dry_run:
        description: Dry run (preview only)
        required: false
        default: false
        type: boolean
      verbose:
        description: Enable verbose logging
        required: false
        default: true
        type: boolean

env:
  # For workflow file updates, you need a Personal Access Token with 'repo' and 'workflow' scopes
  # Create a PAT at: https://github.com/settings/tokens
  # Add it as a repository secret named 'BUDDY_BOT_TOKEN'
  # If BUDDY_BOT_TOKEN is not available, falls back to GITHUB_TOKEN (limited permissions)
  GITHUB_TOKEN: ${tokenEnv}

permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: write
  checks: read
  statuses: read

jobs:
  # Job to determine which jobs should run based on trigger
  determine-jobs:
    runs-on: ubuntu-latest
    outputs:
      run_check: \${{ steps.determine.outputs.run_check }}
      run_update: \${{ steps.determine.outputs.run_update }}
      run_dashboard: \${{ steps.determine.outputs.run_dashboard }}
    steps:
      - name: Determine which jobs to run
        id: determine
        run: |
          # Default to not running any jobs
          echo "run_check=false" >> \$GITHUB_OUTPUT
          echo "run_update=false" >> \$GITHUB_OUTPUT
          echo "run_dashboard=false" >> \$GITHUB_OUTPUT

          if [ "\${{ github.event_name }}" = "workflow_dispatch" ]; then
            JOB="\${{ github.event.inputs.job || 'all' }}"
            if [ "\$JOB" = "all" ] || [ "\$JOB" = "check" ]; then
              echo "run_check=true" >> \$GITHUB_OUTPUT
            fi
            if [ "\$JOB" = "all" ] || [ "\$JOB" = "update" ]; then
              echo "run_update=true" >> \$GITHUB_OUTPUT
            fi
            if [ "\$JOB" = "all" ] || [ "\$JOB" = "dashboard" ]; then
              echo "run_dashboard=true" >> \$GITHUB_OUTPUT
            fi
          elif [ "\${{ github.event_name }}" = "schedule" ]; then
            # Determine based on cron schedule
            if [ "\${{ github.event.schedule }}" = "*/1 * * * *" ]; then
              echo "run_check=true" >> \$GITHUB_OUTPUT
            elif [ "\${{ github.event.schedule }}" = "0 */2 * * *" ]; then
              echo "run_update=true" >> \$GITHUB_OUTPUT
            elif [ "\${{ github.event.schedule }}" = "15 */2 * * *" ]; then
              echo "run_dashboard=true" >> \$GITHUB_OUTPUT
            fi
          fi

  # Shared setup job for common dependencies
  setup:
    runs-on: ubuntu-latest
    needs: determine-jobs
    if: \${{ needs.determine-jobs.outputs.run_check == 'true' || needs.determine-jobs.outputs.run_update == 'true' || needs.determine-jobs.outputs.run_dashboard == 'true' }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${tokenEnv}
          fetch-depth: 0 # Fetch full history for rebasing
          persist-credentials: true

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
${generateComposerSetupSteps()}
      - name: Install dependencies
        run: bun install

      - name: Configure Git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      - name: Cache workspace
        uses: actions/cache/save@v4
        with:
          path: |
            .
            !.git
          key: buddy-bot-workspace-\${{ github.sha }}

  # Rebase check job (formerly buddy-check.yml)
  rebase-check:
    runs-on: ubuntu-latest
    needs: [determine-jobs, setup]
    if: \${{ needs.determine-jobs.outputs.run_check == 'true' }}

    steps:
      - name: Restore workspace
        uses: actions/cache/restore@v4
        with:
          path: |
            .
            !.git
          key: buddy-bot-workspace-\${{ github.sha }}
          fail-on-cache-miss: true

      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${tokenEnv}
          fetch-depth: 0
          persist-credentials: true

      - name: Configure Git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      - name: Check token permissions
        run: |
          if [ -z "\${{ secrets.BUDDY_BOT_TOKEN }}" ]; then
            echo "⚠️ Using GITHUB_TOKEN (limited permissions)"
            echo "💡 For full workflow file update support:"
            echo "   1. Create a Personal Access Token with 'repo' and 'workflow' scopes"
            echo "   2. Add it as repository secret 'BUDDY_BOT_TOKEN'"
            echo "   3. Re-run this workflow"
          else
            echo "✅ Using BUDDY_BOT_TOKEN (full permissions)"
          fi

      - name: Check for rebase requests
        run: |
          echo "🔍 Checking for PRs with rebase checkbox enabled..."
          echo "🔧 Environment info:"
          echo "Current directory: \$(pwd)"
          echo "GITHUB_TOKEN set: \$([[ -n \"\$GITHUB_TOKEN\" ]] && echo \"Yes\" || echo \"No\")"
          echo "Repository: \${{ github.repository }}"
          echo "Event: \${{ github.event_name }}"
          echo ""

          echo "🚀 Running update-check command..."
          set -e  # Exit on any error

          if [ "\${{ github.event.inputs.dry_run }}" = "true" ]; then
            echo "📋 Running in DRY RUN mode..."
            bunx buddy-bot update-check --dry-run --verbose
          else
            echo "🔄 Running in LIVE mode..."
            bunx buddy-bot update-check --verbose
          fi

        env:
          GITHUB_TOKEN: ${tokenEnv}

      - name: Create rebase check summary
        if: always()
        run: |
          echo "## 🔄 Rebase Check Summary" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "- **Triggered by**: \${{ github.event_name }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Dry run**: \${{ github.event.inputs.dry_run || 'false' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Time**: \$(date)" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY

          if [ "\${{ github.event_name }}" = "schedule" ]; then
            echo "⏰ **Scheduled Check**: Automatically checks every minute" >> \$GITHUB_STEP_SUMMARY
          else
            echo "🖱️ **Manual Check**: Manually triggered from Actions tab" >> \$GITHUB_STEP_SUMMARY
          fi

          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "📋 View detailed logs above for rebase results." >> \$GITHUB_STEP_SUMMARY

  # Dependency update job (formerly buddy-update.yml)
  dependency-update:
    runs-on: ubuntu-latest
    needs: [determine-jobs, setup]
    if: \${{ needs.determine-jobs.outputs.run_update == 'true' }}

    steps:
      - name: Restore workspace
        uses: actions/cache/restore@v4
        with:
          path: |
            .
            !.git
          key: buddy-bot-workspace-\${{ github.sha }}
          fail-on-cache-miss: true

      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${tokenEnv}
          fetch-depth: 0
          persist-credentials: true

      - name: Configure Git
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"

      - name: Display update configuration
        run: |
          echo "🧪 **Buddy Bot Update Mode**"
          echo "Strategy: \${{ github.event.inputs.strategy || 'patch' }}"
          echo "Dry Run: \${{ github.event.inputs.dry_run || 'false' }}"
          echo "Packages: \${{ github.event.inputs.packages || 'all' }}"
          echo "Verbose: \${{ github.event.inputs.verbose || 'true' }}"
          echo "Triggered by: \${{ github.event_name }}"
          echo "Repository: \${{ github.repository }}"
          echo "Branch: \${{ github.ref_name }}"

      - name: Run Buddy dependency scan
        run: |
          STRATEGY="\${{ github.event.inputs.strategy || 'patch' }}"
          PACKAGES="\${{ github.event.inputs.packages }}"
          VERBOSE="\${{ github.event.inputs.verbose || 'true' }}"

          echo "🔍 Scanning for dependency updates..."
          echo "Strategy: \$STRATEGY"
          echo "Packages: \${PACKAGES:-all}"
          echo "Verbose: \$VERBOSE"
          echo ""

          set -e  # Exit on any error

          if [ "\$PACKAGES" != "" ]; then
            if [ "\$VERBOSE" = "true" ]; then
              bunx buddy-bot scan --packages "\$PACKAGES" --verbose
            else
              bunx buddy-bot scan --packages "\$PACKAGES"
            fi
          else
            if [ "\$VERBOSE" = "true" ]; then
              bunx buddy-bot scan --strategy "\$STRATEGY" --verbose
            else
              bunx buddy-bot scan --strategy "\$STRATEGY"
            fi
          fi

        env:
          GITHUB_TOKEN: ${tokenEnv}

      - name: Run Buddy dependency updates
        if: \${{ github.event.inputs.dry_run != 'true' }}
        run: |
          STRATEGY="\${{ github.event.inputs.strategy || 'patch' }}"
          PACKAGES="\${{ github.event.inputs.packages }}"
          VERBOSE="\${{ github.event.inputs.verbose || 'true' }}"

          echo "🚀 Running dependency updates..."
          echo "This will create/update PRs if outdated dependencies are found"
          echo ""

          set -e  # Exit on any error

          if [ "\$PACKAGES" != "" ]; then
            if [ "\$VERBOSE" = "true" ]; then
              bunx buddy-bot update --packages "\$PACKAGES" --verbose
            else
              bunx buddy-bot update --packages "\$PACKAGES"
            fi
          else
            if [ "\$VERBOSE" = "true" ]; then
              bunx buddy-bot update --strategy "\$STRATEGY" --verbose
            else
              bunx buddy-bot update --strategy "\$STRATEGY"
            fi
          fi

        env:
          GITHUB_TOKEN: ${tokenEnv}

      - name: Dry run notification
        if: \${{ github.event.inputs.dry_run == 'true' }}
        run: |
          echo "ℹ️ **Dry Run Mode** - No changes were made"
          echo "To apply updates, run this workflow again with 'Dry run' set to false"

      - name: Create update summary
        if: always()
        run: |
          echo "## 🚀 Dependency Update Summary" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "- **Strategy**: \${{ github.event.inputs.strategy || 'patch' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Triggered by**: \${{ github.event_name }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Dry run**: \${{ github.event.inputs.dry_run || 'false' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Packages**: \${{ github.event.inputs.packages || 'all' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Verbose**: \${{ github.event.inputs.verbose || 'true' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Time**: \$(date)" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY

          if [ "\${{ github.event_name }}" = "schedule" ]; then
            echo "⏰ **Scheduled Run**: This was triggered automatically every 2 hours" >> \$GITHUB_STEP_SUMMARY
            echo "💡 **Tip**: Use 'Actions' tab to manually trigger with custom settings" >> \$GITHUB_STEP_SUMMARY
          else
            echo "🖱️ **Manual Trigger**: This was triggered manually from the Actions tab" >> \$GITHUB_STEP_SUMMARY
            echo "⏰ **Auto-Schedule**: This workflow also runs every 2 hours" >> \$GITHUB_STEP_SUMMARY
          fi

          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "📊 View detailed logs above for scan and update results." >> \$GITHUB_STEP_SUMMARY

  # Dashboard update job (formerly buddy-dashboard.yml)
  dashboard-update:
    runs-on: ubuntu-latest
    needs: [determine-jobs, setup, dependency-update]
    if: \${{ needs.determine-jobs.outputs.run_dashboard == 'true' && always() }}

    steps:
      - name: Restore workspace
        uses: actions/cache/restore@v4
        with:
          path: |
            .
            !.git
          key: buddy-bot-workspace-\${{ github.sha }}
          fail-on-cache-miss: true

      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${tokenEnv}

      - name: Display dashboard configuration
        run: |
          echo "📊 **Buddy Bot Dashboard Management**"
          echo "Pin Dashboard: \${{ github.event.inputs.pin || 'true' }}"
          echo "Custom Title: \${{ github.event.inputs.title || 'default' }}"
          echo "Issue Number: \${{ github.event.inputs.issue_number || 'auto-detect' }}"
          echo "Verbose: \${{ github.event.inputs.verbose || 'true' }}"
          echo "Dry Run: \${{ github.event.inputs.dry_run || 'false' }}"
          echo "Triggered by: \${{ github.event_name }}"
          echo "Repository: \${{ github.repository }}"
          echo "Branch: \${{ github.ref_name }}"

      - name: Update Dependency Dashboard
        run: |
          PIN="\${{ github.event.inputs.pin || 'true' }}"
          TITLE="\${{ github.event.inputs.title }}"
          ISSUE_NUMBER="\${{ github.event.inputs.issue_number }}"
          VERBOSE="\${{ github.event.inputs.verbose || 'true' }}"
          DRY_RUN="\${{ github.event.inputs.dry_run || 'false' }}"

          echo "📊 Updating dependency dashboard..."
          echo "Pin: \$PIN"
          echo "Title: \${TITLE:-default}"
          echo "Issue Number: \${ISSUE_NUMBER:-auto-detect}"
          echo "Verbose: \$VERBOSE"
          echo "Dry Run: \$DRY_RUN"
          echo ""

          set -e  # Exit on any error

          # Build the command
          COMMAND="bunx buddy-bot dashboard"

          if [ "\$PIN" = "true" ]; then
            COMMAND="\$COMMAND --pin"
          fi

          if [ "\$TITLE" != "" ]; then
            COMMAND="\$COMMAND --title \\"\$TITLE\\""
          fi

          if [ "\$ISSUE_NUMBER" != "" ]; then
            COMMAND="\$COMMAND --issue-number \\"\$ISSUE_NUMBER\\""
          fi

          if [ "\$VERBOSE" = "true" ]; then
            COMMAND="\$COMMAND --verbose"
          fi

          if [ "\$DRY_RUN" = "true" ]; then
            echo "📋 DRY RUN MODE - Command that would be executed:"
            echo "\$COMMAND"
            echo ""
            echo "ℹ️ In dry run mode, dashboard content would be generated but no issue would be created/updated"

            # Run scan to show what would be included
            echo "🔍 Scanning for dependencies that would be included:"
            if [ "\$VERBOSE" = "true" ]; then
              bunx buddy-bot scan --verbose
            else
              bunx buddy-bot scan
            fi
          else
            echo "🚀 Executing dashboard update:"
            echo "\$COMMAND"
            echo ""
            eval "\$COMMAND"
          fi

        env:
          GITHUB_TOKEN: ${tokenEnv}

      - name: Dry run notification
        if: \${{ github.event.inputs.dry_run == 'true' }}
        run: |
          echo "ℹ️ **Dry Run Mode** - Dashboard preview completed"
          echo "To actually update the dashboard, run this workflow again with 'Dry run' set to false"

      - name: Check dashboard status
        if: \${{ github.event.inputs.dry_run != 'true' }}
        run: |
          echo "✅ Dashboard update completed"
          echo "🔗 Check your repository issues for the updated dependency dashboard"

          # Try to find and link to the dashboard issue
          echo "📊 Looking for dependency dashboard issue..."

          # Use GitHub CLI to find the dashboard issue
          if command -v gh &> /dev/null; then
            DASHBOARD_URL=\$(gh issue list --label "dashboard,dependencies" --state open --limit 1 --json url --jq '.[0].url' 2>/dev/null || echo "")
            if [ "\$DASHBOARD_URL" != "null" ] && [ "\$DASHBOARD_URL" != "" ]; then
              echo "🎯 Dashboard found: \$DASHBOARD_URL"
            else
              echo "🔍 Dashboard issue not found via CLI, check issues manually"
            fi
          else
            echo "💡 Check your issues tab for the dependency dashboard"
          fi

      - name: Create dashboard summary
        if: always()
        run: |
          echo "## 📊 Dependency Dashboard Summary" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "- **Pin Dashboard**: \${{ github.event.inputs.pin || 'true' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Custom Title**: \${{ github.event.inputs.title || 'default' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Issue Number**: \${{ github.event.inputs.issue_number || 'auto-detect' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Triggered by**: \${{ github.event_name }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Dry run**: \${{ github.event.inputs.dry_run || 'false' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Verbose**: \${{ github.event.inputs.verbose || 'true' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Time**: \$(date)" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY

          if [ "\${{ github.event_name }}" = "schedule" ]; then
            echo "⏰ **Scheduled Update**: This was triggered automatically" >> \$GITHUB_STEP_SUMMARY
            echo "🔄 **Schedule**: Every 2 hours, 15 minutes after dependency updates" >> \$GITHUB_STEP_SUMMARY
            echo "💡 **Tip**: Use 'Actions' tab to manually trigger with custom settings" >> \$GITHUB_STEP_SUMMARY
          else
            echo "🖱️ **Manual Trigger**: This was triggered manually from the Actions tab" >> \$GITHUB_STEP_SUMMARY
            echo "⏰ **Auto-Schedule**: This workflow also runs automatically on schedule" >> \$GITHUB_STEP_SUMMARY
          fi

          echo "" >> \$GITHUB_STEP_SUMMARY

          if [ "\${{ github.event.inputs.dry_run }}" = "true" ]; then
            echo "📋 **Dry Run**: No changes were made. Dashboard content was previewed only." >> \$GITHUB_STEP_SUMMARY
          else
            echo "✅ **Dashboard Updated**: Check your repository issues for the updated dependency dashboard." >> \$GITHUB_STEP_SUMMARY
          fi

          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "📊 View detailed logs above for dashboard update results." >> \$GITHUB_STEP_SUMMARY
`
}

export async function generateCoreWorkflows(preset: WorkflowPreset, repoInfo: RepositoryInfo, hasCustomToken: boolean, logger: Logger): Promise<void> {
  // Ensure output directory exists
  const outputDir = '.github/workflows'
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Generate unified workflow that combines all three previous workflows
  const unifiedWorkflow = generateUnifiedWorkflow(hasCustomToken)
  fs.writeFileSync(path.join(outputDir, 'buddy-bot.yml'), unifiedWorkflow)
  logger.info('Generated unified buddy-bot workflow (combines check, update, and dashboard)')

  // Clean up old workflow files if they exist
  const oldFiles = ['buddy-check.yml', 'buddy-update.yml', 'buddy-dashboard.yml']
  let cleanedUp = 0

  for (const oldFile of oldFiles) {
    const oldPath = path.join(outputDir, oldFile)
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath)
      logger.info(`Removed old workflow file: ${oldFile}`)
      cleanedUp++
    }
  }

  logger.success(`Generated unified workflow in ${outputDir}`)
  if (cleanedUp > 0) {
    logger.info(`Cleaned up ${cleanedUp} old workflow file${cleanedUp === 1 ? '' : 's'}`)
  }
}

export function getWorkflowPreset(useCase: string): WorkflowPreset {
  const presets: Record<string, WorkflowPreset> = {
    'standard': {
      name: 'Standard Project',
      description: 'Daily patch updates, weekly minor updates, monthly major updates',
      templates: {
        daily: true,
        weekly: true,
        monthly: true,
      },
      schedules: {
        dashboard: '0 9 * * 1,3,5',
        updates: '0 9 * * 1,3,5',
      },
      strategy: 'all',
      autoMerge: false,
      custom: [],
    },
    'high-frequency': {
      name: 'High Frequency Updates',
      description: 'Check for updates 4 times per day (6AM, 12PM, 6PM, 12AM)',
      templates: {},
      schedules: {
        dashboard: '0 9 * * *',
        updates: '0 */6 * * *',
      },
      strategy: 'all',
      autoMerge: true,
      custom: [
        { name: 'morning-updates', schedule: '0 6 * * *', strategy: 'patch', autoMerge: true, autoMergeStrategy: 'squash' },
        { name: 'noon-updates', schedule: '0 12 * * *', strategy: 'patch', autoMerge: true, autoMergeStrategy: 'squash' },
        { name: 'evening-updates', schedule: '0 18 * * *', strategy: 'patch', autoMerge: true, autoMergeStrategy: 'squash' },
        { name: 'midnight-updates', schedule: '0 0 * * *', strategy: 'minor', autoMerge: false },
      ],
    },
    'security': {
      name: 'Security Focused',
      description: 'Frequent patch updates with security-first approach',
      templates: {},
      schedules: {
        dashboard: '0 9 * * *',
        updates: '0 */4 * * *',
      },
      strategy: 'all',
      autoMerge: true,
      custom: [
        { name: 'security-patches', schedule: '0 */6 * * *', strategy: 'patch', autoMerge: true, autoMergeStrategy: 'squash' },
        { name: 'weekly-minor', schedule: '0 9 * * 1', strategy: 'minor', autoMerge: false },
      ],
    },
    'minimal': {
      name: 'Minimal Updates',
      description: 'Weekly patch updates, monthly minor/major updates',
      templates: {
        weekly: true,
        monthly: true,
      },
      schedules: {
        dashboard: '0 9 * * 1',
        updates: '0 9 * * 1',
      },
      strategy: 'all',
      autoMerge: false,
      custom: [],
    },
    'docker': {
      name: 'Docker Project',
      description: 'Optimized for containerized applications',
      templates: {
        docker: true,
        weekly: true,
      },
      schedules: {
        dashboard: '0 9 * * 1',
        updates: '0 9 * * 1',
      },
      strategy: 'all',
      autoMerge: false,
      custom: [],
    },
    'monorepo': {
      name: 'Monorepo',
      description: 'Multiple packages in a single repository',
      templates: {
        monorepo: true,
        daily: true,
      },
      schedules: {
        dashboard: '0 9 * * *',
        updates: '0 9 * * *',
      },
      strategy: 'all',
      autoMerge: false,
      custom: [],
    },
    'testing': {
      name: 'Development/Testing',
      description: 'Manual trigger + every 5 minutes (for testing)',
      templates: {},
      schedules: {
        dashboard: 'manual',
        updates: '*/15 * * * *',
      },
      strategy: 'patch',
      autoMerge: false,
      custom: [
        {
          name: 'testing-updates',
          schedule: '*/5 * * * *',
          strategy: 'patch',
          autoMerge: false, // No auto-merge for testing
        },
      ],
    },
    'custom': {
      name: 'Custom Configuration',
      description: 'Create your own update schedule',
      templates: {},
      schedules: {
        dashboard: 'manual',
        updates: 'manual',
      },
      strategy: 'all',
      autoMerge: false,
      custom: [],
    },
  }

  return presets[useCase] || presets.standard
}

// Enhanced testing and validation functions
export async function validateWorkflowGeneration(workflowContent: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    success: true,
    errors: [],
    warnings: [],
    suggestions: [],
  }

  // Basic YAML syntax validation
  if (!workflowContent.includes('name:')) {
    result.errors.push('Workflow missing required "name" field')
    result.success = false
  }

  if (!workflowContent.includes('on:')) {
    result.errors.push('Workflow missing required "on" trigger field')
    result.success = false
  }

  if (!workflowContent.includes('jobs:')) {
    result.errors.push('Workflow missing required "jobs" field')
    result.success = false
  }

  // Check for security best practices
  // eslint-disable-next-line no-template-curly-in-string
  if (workflowContent.includes('${{ secrets.GITHUB_TOKEN }}')) {
    result.suggestions.push('Using default GITHUB_TOKEN. Consider using a Personal Access Token for full functionality.')
  }

  if (!workflowContent.includes('permissions:')) {
    result.warnings.push('Workflow permissions not explicitly defined. This may cause issues.')
  }

  // Check for required buddy-bot steps
  if (!workflowContent.includes('bunx buddy-bot')) {
    result.errors.push('Workflow missing buddy-bot execution commands')
    result.success = false
  }

  return result
}

export async function validateRepositoryAccess(repoInfo: RepositoryInfo): Promise<ValidationResult> {
  const result: ValidationResult = {
    success: true,
    errors: [],
    warnings: [],
    suggestions: [],
  }

  try {
    // Check if repository exists and is accessible
    const response = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.name}`)

    if (response.status === 404) {
      result.errors.push('Repository not found or not accessible')
      result.success = false
      return result
    }

    if (response.status === 403) {
      result.errors.push('Access forbidden. Check repository permissions.')
      result.success = false
      return result
    }

    if (response.ok) {
      const repoData = await response.json() as {
        archived?: boolean
        private?: boolean
        has_issues?: boolean
        permissions?: { push?: boolean }
      }

      // Check repository properties
      if (repoData.archived) {
        result.warnings.push('Repository is archived. Updates may not be useful.')
      }

      if (repoData.private) {
        result.suggestions.push('Private repository detected. Ensure token has appropriate access.')
      }

      if (!repoData.has_issues) {
        result.warnings.push('Issues are disabled. Dashboard functionality will not work.')
      }

      if (!repoData.permissions?.push) {
        result.warnings.push('Limited repository permissions detected. Some features may not work.')
      }
    }
  }
  catch {
    result.warnings.push('Could not validate repository access. Network or API issues.')
  }

  return result
}

export function displayValidationResults(results: ValidationResult, title: string): void {
  console.log(`\n${title}:`)

  if (results.errors.length > 0) {
    console.log('❌ Errors:')
    results.errors.forEach(error => console.log(`   • ${error}`))
  }

  if (results.warnings.length > 0) {
    console.log('⚠️  Warnings:')
    results.warnings.forEach(warning => console.log(`   • ${warning}`))
  }

  if (results.suggestions.length > 0) {
    console.log('💡 Suggestions:')
    results.suggestions.forEach(suggestion => console.log(`   • ${suggestion}`))
  }

  if (results.errors.length === 0 && results.warnings.length === 0) {
    console.log('✅ All checks passed!')
  }
}

export async function setupCustomWorkflow(preset: WorkflowPreset, _logger: Logger): Promise<void> {
  const response = await prompts([
    {
      type: 'multiselect',
      name: 'templates',
      message: 'Which built-in workflow templates would you like to enable?',
      choices: [
        { title: 'Daily Updates', description: 'Run patch updates daily', value: 'daily' },
        { title: 'Weekly Updates', description: 'Run minor updates weekly', value: 'weekly' },
        { title: 'Monthly Updates', description: 'Run major updates monthly', value: 'monthly' },
        { title: 'Comprehensive', description: 'All-in-one workflow', value: 'comprehensive' },
        { title: 'Docker Support', description: 'Container-optimized workflows', value: 'docker' },
        { title: 'Monorepo Support', description: 'Multi-package workflows', value: 'monorepo' },
      ],
    },
    {
      type: 'confirm',
      name: 'addCustom',
      message: 'Would you like to add custom workflow schedules?',
      initial: false,
    },
  ])

  // Enable selected templates
  if (response.templates) {
    for (const template of response.templates) {
      preset.templates[template as keyof typeof preset.templates] = true
    }
  }

  // Add custom workflows if requested
  if (response.addCustom) {
    let addMore = true
    preset.custom = preset.custom || []

    while (addMore) {
      const customWorkflow = await prompts([
        {
          type: 'text',
          name: 'name',
          message: 'Workflow name (e.g., "security-updates"):',
          validate: (value: string) => value.length > 0 ? true : 'Name is required',
        },
        {
          type: 'select',
          name: 'schedule',
          message: 'Update frequency:',
          choices: [
            { title: 'Every 6 hours', value: '0 */6 * * *' },
            { title: 'Twice daily (9AM, 9PM)', value: '0 9,21 * * *' },
            { title: 'Daily at 9AM', value: '0 9 * * *' },
            { title: 'Weekly (Monday 9AM)', value: '0 9 * * 1' },
            { title: 'Custom cron expression', value: 'custom' },
          ],
        },
        {
          type: prev => prev === 'custom' ? 'text' : null,
          name: 'customSchedule',
          message: 'Enter cron expression (e.g., "0 */4 * * *"):',
          validate: (value: string) => value.length > 0 ? true : 'Cron expression is required',
        },
        {
          type: 'select',
          name: 'strategy',
          message: 'Update strategy:',
          choices: [
            { title: 'Patch only (safest)', value: 'patch' },
            { title: 'Minor + Patch', value: 'minor' },
            { title: 'All updates', value: 'all' },
          ],
        },
        {
          type: 'confirm',
          name: 'autoMerge',
          message: 'Enable auto-merge for this workflow?',
          initial: false,
        },
        {
          type: prev => prev ? 'select' : null,
          name: 'autoMergeStrategy',
          message: 'Auto-merge strategy:',
          choices: [
            { title: 'Squash and merge (recommended)', value: 'squash' },
            { title: 'Create a merge commit', value: 'merge' },
            { title: 'Rebase and merge', value: 'rebase' },
          ],
          initial: 0,
        },
      ])

      if (customWorkflow.name) {
        preset.custom.push({
          name: customWorkflow.name,
          schedule: customWorkflow.customSchedule || customWorkflow.schedule,
          strategy: customWorkflow.strategy,
          autoMerge: customWorkflow.autoMerge,
          autoMergeStrategy: customWorkflow.autoMergeStrategy,
        })
      }

      const continueResponse = await prompts({
        type: 'confirm',
        name: 'continue',
        message: 'Add another custom workflow?',
        initial: false,
      })

      addMore = continueResponse.continue
    }
  }
}

export async function showFinalInstructions(repoInfo: RepositoryInfo, hasCustomToken: boolean): Promise<void> {
  console.log('✅ Generated unified buddy-bot workflow in .github/workflows/:')
  console.log(`   - buddy-bot.yml (Combined check, update, and dashboard management)`)
  console.log(`📁 Configuration file: buddy-bot.config.ts`)

  console.log(`\n🚀 Next Steps:`)
  console.log(`1. Review and commit the generated workflow files`)
  console.log(`   git add .github/workflows/ buddy-bot.config.ts`)
  console.log(`   git commit -m "Add Buddy Bot dependency management workflows"`)
  console.log(`   git push`)

  if (hasCustomToken) {
    console.log(`\n2. 🔑 Complete your token setup:`)
    console.log(`   ✅ Your Personal Access Token should be configured as:`)
    console.log(`      • Organization secret: BUDDY_BOT_TOKEN (recommended), or`)
    console.log(`      • Repository secret: BUDDY_BOT_TOKEN`)
    console.log(`   💡 The workflows will automatically detect and use your token`)
  }
  else {
    console.log(`\n2. ⚠️  Using default GITHUB_TOKEN (limited functionality):`)
    console.log(`   • Dependency updates: ✅ Will work`)
    console.log(`   • Dashboard creation: ✅ Will work`)
    console.log(`   • Workflow file updates: ❌ Won't work`)
    console.log(`   💡 Consider setting up a Personal Access Token later for full functionality`)
  }

  console.log(`\n3. 🔧 Configure repository permissions:`)
  console.log(`   - Go to: https://github.com/${repoInfo.owner}/${repoInfo.name}/settings/actions`)
  console.log(`   - Under "Workflow permissions":`)
  console.log(`     ✅ Select "Read and write permissions"`)
  console.log(`     ✅ Check "Allow GitHub Actions to create and approve pull requests"`)
  console.log(`   - Click "Save"`)

  console.log(`\n🎉 Setup Complete!`)
  console.log(`💡 Your workflows will now run automatically on schedule!`)
  console.log(`📊 First dashboard update will appear within 24 hours`)
  console.log(`🔗 Learn more: https://docs.github.com/en/actions`)
}
