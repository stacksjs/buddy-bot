#!/usr/bin/env bun

import type { BuddyBotConfig } from '../src/types'
import fs from 'node:fs'
import process from 'node:process'
import { CLI } from '@stacksjs/clapp'
import prompts from 'prompts'
import { version } from '../package.json'
import { Buddy } from '../src/buddy'
import { config } from '../src/config'
import {
  analyzeProject,
  ConfigurationMigrator,
  confirmTokenSetup,
  createProgressTracker,
  detectRepository,
  displayProgress,
  displayValidationResults,
  generateConfigFile,
  generateCoreWorkflows,
  getWorkflowPreset,
  guideRepositorySettings,
  guideTokenCreation,
  PluginManager,
  runPreflightChecks,
  setupCustomWorkflow,
  showFinalInstructions,
  updateProgress,
  validateRepositoryAccess,
  validateWorkflowGeneration,
} from '../src/setup'
import { Logger } from '../src/utils/logger'

const cli = new CLI('buddy-bot')

cli.usage(`[command] [options]

🤖 Buddy Bot - Your companion dependency manager

Supports npm, Bun, yarn, pnpm, Composer, pkgx, Launchpad, GitHub Actions, and Dockerfiles
Automatically migrates from Renovate and Dependabot

DEPENDENCY MANAGEMENT:
  setup         🚀 Interactive setup for automated updates (recommended)
  scan          🔍 Scan for dependency updates
  dashboard     📊 Create or update dependency dashboard issue
  update        ⬆️  Update dependencies and create PRs
  rebase        🔄 Rebase/retry a pull request with latest updates
  update-check  🔍 Auto-detect and rebase PRs with checked rebase box
  check         📋 Check specific packages for updates
  schedule      ⏰ Run automated updates on schedule

PACKAGE INFORMATION:
  info          📦 Show detailed package information
  versions      📈 Show all available versions of a package
  latest        ⭐ Get the latest version of a package
  exists        ✅ Check if a package exists in the registry
  deps          🔗 Show package dependencies
  compare       ⚖️  Compare two versions of a package
  search        🔍 Search for packages in the registry

BRANCH MANAGEMENT:
  cleanup       🧹 Clean up stale buddy-bot branches
  list-branches 📋 List all buddy-bot branches and their status

CONFIGURATION & SETUP:
  open-settings 🔧 Open GitHub repository and organization settings pages

Examples:
  buddy-bot setup                      # Interactive setup with migration
  buddy-bot setup --non-interactive    # Automated setup for CI/CD
  buddy-bot scan --verbose             # Scan for updates (npm + Composer + Dockerfiles)
  buddy-bot rebase 17                  # Rebase PR #17
  buddy-bot update-check               # Auto-rebase checked PRs
  buddy-bot cleanup                    # Clean up stale branches
  buddy-bot list-branches              # List all buddy-bot branches
  buddy-bot info laravel/framework     # Get Composer package info
  buddy-bot info react                 # Get npm package info
  buddy-bot versions react --latest 5  # Show recent versions
  buddy-bot search "test framework"    # Search packages
  buddy-bot open-settings              # Open GitHub settings

Migration:
  - Automatically detects Renovate and Dependabot configurations
  - Converts settings to Buddy Bot format with compatibility report
  - Generates optimized GitHub Actions workflows
  - Provides migration guidance and best practices`)

// Define CLI options interface to match our core types
interface CLIOptions {
  verbose?: boolean
  config?: string
  packages?: string
  pattern?: string
  strategy?: 'major' | 'minor' | 'patch' | 'all'
  ignore?: string
  dryRun?: boolean
  respectLatest?: boolean
}

cli
  .command('setup', '🚀 Interactive setup for automated dependency updates (recommended)')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--non-interactive', 'Run setup without prompts (use defaults)')
  .option('--preset <type>', 'Workflow preset: standard|high-frequency|security|minimal|testing', { default: 'standard' })
  .option('--token-setup <type>', 'Token setup: existing-secret|new-pat|default-token', { default: 'default-token' })
  .example('buddy-bot setup')
  .example('buddy-bot setup --verbose')
  .example('buddy-bot setup --non-interactive')
  .example('buddy-bot setup --non-interactive --preset testing --verbose')
  .action(async (options: CLIOptions & { nonInteractive?: boolean, preset?: string, tokenSetup?: string }) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      console.log('🤖 Welcome to Buddy Bot Setup!')
      console.log('Let\'s configure automated dependency updates for your project.\n')

      // Initialize progress tracking
      const progress = createProgressTracker(10) // Updated total steps including new features
      displayProgress(progress)

      // Configuration Migration Detection
      updateProgress(progress, 'Detecting existing configurations')
      displayProgress(progress)

      const migrator = new ConfigurationMigrator()
      const existingTools = await migrator.detectExistingTools()
      const migrationResults: any[] = []

      if (existingTools.length > 0 && !options.nonInteractive) {
        console.log(`\n🔍 Configuration Migration Detection:`)
        console.log(`Found ${existingTools.length} existing dependency management tool(s):`)
        existingTools.forEach(tool => console.log(`   • ${tool.name} (${tool.configFile})`))

        const migrateResponse = await prompts({
          type: 'confirm',
          name: 'migrate',
          message: 'Would you like to migrate existing configurations to Buddy Bot?',
          initial: true,
        })

        if (migrateResponse.migrate) {
          console.log('\n📋 Migrating configurations...')
          for (const tool of existingTools) {
            try {
              let result
              if (tool.name === 'renovate') {
                result = await migrator.migrateFromRenovate(tool.configFile)
              }
              else if (tool.name === 'dependabot') {
                result = await migrator.migrateFromDependabot(tool.configFile)
              }
              else {
                continue
              }
              migrationResults.push(result)
              console.log(`✅ Migrated ${tool.name} configuration`)
            }
            catch (error) {
              console.log(`⚠️  Failed to migrate ${tool.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }

          if (migrationResults.length > 0) {
            const report = await migrator.generateMigrationReport(migrationResults)
            console.log(`\n${report}`)
          }
        }
      }
      else if (existingTools.length > 0 && options.nonInteractive) {
        console.log(`\n🔍 Found ${existingTools.length} existing tool(s), skipping migration in non-interactive mode`)
      }

      // Plugin Discovery
      updateProgress(progress, 'Discovering integrations', true)
      displayProgress(progress)

      const pluginManager = new PluginManager()
      const availablePlugins = await pluginManager.discoverPlugins()

      if (availablePlugins.length > 0 && !options.nonInteractive) {
        console.log(`\n🔌 Integration Discovery:`)
        console.log(`Found ${availablePlugins.length} available integration(s):`)
        availablePlugins.forEach(plugin => console.log(`   • ${plugin.name} v${plugin.version}`))

        const pluginResponse = await prompts({
          type: 'confirm',
          name: 'enablePlugins',
          message: 'Would you like to enable these integrations?',
          initial: true,
        })

        if (pluginResponse.enablePlugins) {
          for (const plugin of availablePlugins) {
            await pluginManager.loadPlugin(plugin)
          }
        }
      }
      else if (availablePlugins.length > 0 && options.nonInteractive) {
        console.log(`\n🔌 Found ${availablePlugins.length} integration(s), skipping in non-interactive mode`)
      }

      // Pre-flight checks
      updateProgress(progress, 'Running pre-flight checks', true)
      displayProgress(progress)

      const preflightResults = await runPreflightChecks()
      displayValidationResults(preflightResults, '🔍 Pre-flight Validation')

      if (!preflightResults.success) {
        console.log('\n❌ Pre-flight checks failed. Please fix the errors above and try again.')
        process.exit(1)
      }

      // Project analysis
      updateProgress(progress, 'Analyzing project', true)
      displayProgress(progress)

      const projectAnalysis = await analyzeProject()
      console.log(`\n🔍 Project Analysis:`)
      console.log(`📦 Project Type: ${projectAnalysis.type}`)
      console.log(`⚙️  Package Manager: ${projectAnalysis.packageManager}`)
      console.log(`🔒 Lock File: ${projectAnalysis.hasLockFile ? 'Found' : 'Not found'}`)
      console.log(`📄 Dependency Files: ${projectAnalysis.hasDependencyFiles ? 'Found' : 'None'}`)
      console.log(`🔄 GitHub Actions: ${projectAnalysis.hasGitHubActions ? 'Found' : 'None'}`)
      console.log(`💡 Recommended Preset: ${projectAnalysis.recommendedPreset}`)

      if (projectAnalysis.recommendations.length > 0) {
        console.log('\n📋 Recommendations:')
        projectAnalysis.recommendations.forEach((rec: string) => console.log(`   • ${rec}`))
      }

      // Step 1: Repository Detection
      updateProgress(progress, 'Repository Detection', true)
      displayProgress(progress)

      console.log('\n📍 Repository Detection')
      const repoInfo = await detectRepository()
      if (!repoInfo) {
        console.log('❌ Could not detect repository. Please ensure you\'re in a Git repository.')
        process.exit(1)
      }

      console.log(`✅ Detected repository: ${repoInfo.owner}/${repoInfo.name}`)
      console.log(`🔗 GitHub URL: https://github.com/${repoInfo.owner}/${repoInfo.name}`)

      // Validate repository access
      const repoValidation = await validateRepositoryAccess(repoInfo)
      if (repoValidation.warnings.length > 0 || repoValidation.suggestions.length > 0) {
        displayValidationResults(repoValidation, '🔍 Repository Validation')
      }

      // Step 2: Token Setup Guide
      updateProgress(progress, 'GitHub Token Setup', true)
      displayProgress(progress)

      console.log('\n🔑 GitHub Token Setup')
      console.log('For full functionality, Buddy Bot needs appropriate GitHub permissions.')
      console.log('This enables workflow file updates and advanced GitHub Actions features.\n')

      let tokenSetup
      if (options.nonInteractive) {
        // Use default token setup based on flag
        switch (options.tokenSetup) {
          case 'existing-secret':
            tokenSetup = { hasCustomToken: true, needsGuide: false }
            console.log('✅ Using existing organization/repository secrets')
            break
          case 'new-pat':
            tokenSetup = { hasCustomToken: true, needsGuide: true }
            console.log('⚠️  Non-interactive mode: Will use custom token but skip setup guide')
            break
          case 'default-token':
          default:
            tokenSetup = { hasCustomToken: false, needsGuide: false }
            console.log('✅ Using default GITHUB_TOKEN (limited functionality)')
            break
        }
      }
      else {
        tokenSetup = await confirmTokenSetup()
        if (tokenSetup.needsGuide) {
          await guideTokenCreation(repoInfo)
        }
      }

      // Step 3: Repository Settings
      updateProgress(progress, 'Repository Settings', true)
      displayProgress(progress)

      console.log('\n🔧 Repository Settings')
      await guideRepositorySettings(repoInfo)

      // Step 4: Workflow Configuration
      updateProgress(progress, 'Workflow Configuration', true)
      displayProgress(progress)

      console.log('\n⚙️  Workflow Configuration')
      let workflowResponse
      if (options.nonInteractive) {
        workflowResponse = { useCase: options.preset }
        console.log(`✅ Using ${options.preset} preset for workflow configuration`)
      }
      else {
        workflowResponse = await prompts([
          {
            type: 'select',
            name: 'useCase',
            message: 'What type of update schedule would you like?',
            choices: [
              {
                title: 'Standard Setup (Recommended)',
                description: 'Dashboard updates 3x/week, dependency updates on schedule',
                value: 'standard',
              },
              {
                title: 'High Frequency',
                description: 'Check for updates multiple times per day',
                value: 'high-frequency',
              },
              {
                title: 'Security Focused',
                description: 'Frequent patch updates with security-first approach',
                value: 'security',
              },
              {
                title: 'Minimal Updates',
                description: 'Weekly checks, lower frequency',
                value: 'minimal',
              },
              {
                title: 'Development/Testing',
                description: 'Manual triggers + frequent checks for testing',
                value: 'testing',
              },
              {
                title: 'Custom Configuration',
                description: 'Create your own schedule',
                value: 'custom',
              },
            ],
          },
        ])

        if (!workflowResponse.useCase) {
          console.log('Setup cancelled.')
          return
        }
      }

      // Step 5: Generate Configuration File
      updateProgress(progress, 'Configuration File', true)
      displayProgress(progress)

      console.log('\n📝 Configuration File')
      await generateConfigFile(repoInfo, tokenSetup.hasCustomToken)

      // Step 6: Generate Workflows
      updateProgress(progress, 'Workflow Generation', true)
      displayProgress(progress)

      console.log('\n🔄 Workflow Generation')
      const preset = getWorkflowPreset(workflowResponse.useCase)

      if (workflowResponse.useCase === 'custom' && !options.nonInteractive) {
        await setupCustomWorkflow(preset, logger)
      }
      else {
        console.log(`✨ Setting up ${preset.name}...`)
        console.log(`📋 ${preset.description}`)
      }

      // Generate the core workflows based on the provided templates
      await generateCoreWorkflows(preset, repoInfo, tokenSetup.hasCustomToken, logger)

      // Step 7: Workflow Validation
      updateProgress(progress, 'Workflow Validation', true)
      displayProgress(progress)

      console.log('\n🔍 Validating Generated Workflows')

      // Validate each generated workflow
      const workflowFiles = [
        { name: 'buddy-dashboard.yml', content: '' },
        { name: 'buddy-check.yml', content: '' },
        { name: 'buddy-update.yml', content: '' },
      ]

      let validationPassed = true
      for (const workflowFile of workflowFiles) {
        try {
          const workflowPath = `.github/workflows/${workflowFile.name}`
          if (fs.existsSync(workflowPath)) {
            const content = fs.readFileSync(workflowPath, 'utf8')
            const validation = await validateWorkflowGeneration(content)

            if (!validation.success) {
              console.log(`❌ ${workflowFile.name} validation failed`)
              displayValidationResults(validation, `${workflowFile.name} Issues`)
              validationPassed = false
            }
            else {
              console.log(`✅ ${workflowFile.name} validated successfully`)
            }
          }
        }
        catch {
          console.log(`⚠️  Could not validate ${workflowFile.name}`)
        }
      }

      if (!validationPassed) {
        console.log('\n⚠️  Some workflows have validation issues. Please review the warnings above.')
      }

      // Step 8: Final Setup Instructions & Plugin Execution
      updateProgress(progress, 'Setup Complete', true)
      displayProgress(progress)

      console.log('\n🎉 Setup Complete!')
      await showFinalInstructions(repoInfo, tokenSetup.hasCustomToken)

      // Execute plugin hooks for setup completion
      if (availablePlugins.length > 0) {
        console.log('\n🔌 Executing integration hooks...')
        const setupContext = {
          step: 'setup_complete',
          progress,
          config: migrationResults.length > 0 ? migrationResults[0].migratedSettings : {},
          repository: repoInfo,
          analysis: projectAnalysis,
          plugins: availablePlugins,
        }

        pluginManager.setContext(setupContext)
        await pluginManager.executePluginHooks({ event: 'setup_complete' })
      }
    }
    catch (error) {
      logger.error('Setup failed:', error)
      process.exit(1)
    }
  })

cli
  .command('scan', 'Scan for dependency updates')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--packages <names>', 'Comma-separated list of packages to check')
  .option('--pattern <pattern>', 'Glob pattern to match packages')
  .option('--strategy <type>', 'Update strategy: major|minor|patch|all', { default: 'all' })
  .option('--ignore <names>', 'Comma-separated list of packages to ignore')
  .option('--respect-latest', 'Respect "latest", "*", and other dynamic version indicators (default: true)')
  .option('--no-respect-latest', 'Allow updating "latest", "*", and other dynamic version indicators')
  .example('buddy-bot scan')
  .example('buddy-bot scan --verbose')
  .example('buddy-bot scan --packages "react,typescript,laravel/framework"')
  .example('buddy-bot scan --pattern "@types/*"')
  .example('buddy-bot scan --strategy minor')
  .example('buddy-bot scan --no-respect-latest')
  .action(async (options: CLIOptions) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      logger.info('Loading configuration...')

      // Parse packages from string if provided
      let packages: string[] | undefined
      if (options.packages) {
        packages = options.packages.split(',').map(p => p.trim())
      }

      // Parse ignore list from string if provided
      let ignore: string[] | undefined
      if (options.ignore) {
        ignore = options.ignore.split(',').map(p => p.trim())
      }

      // Override config with CLI options
      const finalConfig: BuddyBotConfig = {
        ...config,
        verbose: options.verbose ?? config.verbose,
        packages: {
          ...config.packages,
          strategy: options.strategy ?? config.packages?.strategy ?? 'all',
          ignore: ignore ?? config.packages?.ignore,
          respectLatest: options.respectLatest ?? config.packages?.respectLatest ?? true,
        },
      }

      const buddy = new Buddy(finalConfig)

      if (packages?.length) {
        logger.info(`Checking specific packages: ${packages.join(', ')}`)
        const updates = await buddy.checkPackages(packages)

        if (updates.length === 0) {
          logger.success('All specified packages are up to date!')
        }
        else {
          logger.info(`Found ${updates.length} updates:`)
          for (const update of updates) {
            logger.info(`  ${update.name}: ${update.currentVersion} → ${update.newVersion} (${update.updateType})`)
          }
        }
        return
      }

      if (options.pattern) {
        logger.info(`Checking packages with pattern: ${options.pattern}`)
        const updates = await buddy.checkPackagesWithPattern(options.pattern)

        if (updates.length === 0) {
          logger.success('All matching packages are up to date!')
        }
        else {
          logger.info(`Found ${updates.length} updates:`)
          for (const update of updates) {
            logger.info(`  ${update.name}: ${update.currentVersion} → ${update.newVersion} (${update.updateType})`)
          }
        }
        return
      }

      // Full project scan
      const scanResult = await buddy.scanForUpdates()

      if (scanResult.updates.length === 0) {
        logger.success('All dependencies are up to date!')
        return
      }

      logger.info(`\nScan Results:`)
      logger.info(`📦 Total packages: ${scanResult.totalPackages}`)
      logger.info(`🔄 Available updates: ${scanResult.updates.length}`)
      logger.info(`⏱️  Scan duration: ${scanResult.duration}ms`)

      // Group updates by type
      const majorUpdates = scanResult.updates.filter(u => u.updateType === 'major')
      const minorUpdates = scanResult.updates.filter(u => u.updateType === 'minor')
      const patchUpdates = scanResult.updates.filter(u => u.updateType === 'patch')

      if (majorUpdates.length > 0) {
        logger.warn(`\n🚨 Major updates (${majorUpdates.length}):`)
        for (const update of majorUpdates) {
          logger.info(`  ${update.name}: ${update.currentVersion} → ${update.newVersion}`)
        }
      }

      if (minorUpdates.length > 0) {
        logger.info(`\n✨ Minor updates (${minorUpdates.length}):`)
        for (const update of minorUpdates) {
          logger.info(`  ${update.name}: ${update.currentVersion} → ${update.newVersion}`)
        }
      }

      if (patchUpdates.length > 0) {
        logger.info(`\n🔧 Patch updates (${patchUpdates.length}):`)
        for (const update of patchUpdates) {
          logger.info(`  ${update.name}: ${update.currentVersion} → ${update.newVersion}`)
        }
      }

      if (scanResult.groups.length > 0) {
        logger.info(`\n📋 Update groups (${scanResult.groups.length}):`)
        for (const group of scanResult.groups) {
          logger.info(`  ${group.name}: ${group.updates.length} updates`)
        }
      }
    }
    catch (error) {
      logger.error('Scan failed:', error)
      process.exit(1)
    }
  })

cli
  .command('dashboard', 'Create or update dependency dashboard issue')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--title <title>', 'Custom dashboard title')
  .option('--issue-number <number>', 'Update specific issue number')
  .example('buddy-bot dashboard')
  .example('buddy-bot dashboard --title "My Dependencies"')
  .example('buddy-bot dashboard --issue-number 42')
  .action(async (options: CLIOptions & { pin?: boolean, title?: string, issueNumber?: string }) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      logger.info('Creating or updating dependency dashboard...')

      // Check if repository is configured
      if (!config.repository) {
        logger.error('❌ Repository configuration required for dashboard')
        logger.info('Configure repository.provider, repository.owner, repository.name in buddy-bot.config.ts')
        process.exit(1)
      }

      // Override config with CLI options
      const finalConfig: BuddyBotConfig = {
        ...config,
        verbose: options.verbose ?? config.verbose,
        dashboard: {
          ...config.dashboard,
          enabled: true,
          title: options.title ?? config.dashboard?.title,
          issueNumber: options.issueNumber ? Number.parseInt(options.issueNumber) : config.dashboard?.issueNumber,
        },
      }

      const buddy = new Buddy(finalConfig)
      const issue = await buddy.createOrUpdateDashboard()

      logger.success(`✅ Dashboard updated: ${issue.url}`)
      logger.info(`📊 Issue #${issue.number}: ${issue.title}`)
    }
    catch (error) {
      logger.error('Dashboard creation failed:', error)
      process.exit(1)
    }
  })

cli
  .command('update', 'Update dependencies and create PRs')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--strategy <type>', 'Update strategy: major|minor|patch|all', { default: 'all' })
  .option('--ignore <names>', 'Comma-separated list of packages to ignore')
  .option('--dry-run', 'Preview changes without making them')
  .option('--respect-latest', 'Respect "latest", "*", and other dynamic version indicators (default: true)')
  .option('--no-respect-latest', 'Allow updating "latest", "*", and other dynamic version indicators')
  .example('buddy-bot update')
  .example('buddy-bot update --dry-run')
  .example('buddy-bot update --strategy patch')
  .example('buddy-bot update --verbose')
  .example('buddy-bot update --no-respect-latest')
  .action(async (options: CLIOptions) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      logger.info('Starting dependency update process...')

      // Parse ignore list from string if provided
      let ignore: string[] | undefined
      if (options.ignore) {
        ignore = options.ignore.split(',').map(p => p.trim())
      }

      const finalConfig: BuddyBotConfig = {
        ...config,
        verbose: options.verbose ?? config.verbose,
        packages: {
          ...config.packages,
          strategy: options.strategy ?? config.packages?.strategy ?? 'all',
          ignore: ignore ?? config.packages?.ignore,
          respectLatest: options.respectLatest ?? config.packages?.respectLatest ?? true,
        },
      }

      const buddy = new Buddy(finalConfig)
      const scanResult = await buddy.scanForUpdates()

      if (scanResult.updates.length === 0) {
        logger.success('All dependencies are up to date!')
        return
      }

      if (options.dryRun) {
        logger.info('🔍 Dry run mode - no changes will be made')
        logger.info(`Would create ${scanResult.groups.length} pull request(s):`)
        for (const group of scanResult.groups) {
          logger.info(`  📝 ${group.title} (${group.updates.length} updates)`)
        }
        return
      }

      // Create pull requests
      await buddy.createPullRequests(scanResult)
      logger.success('Update process completed!')
    }
    catch (error) {
      logger.error('Update failed:', error)
      process.exit(1)
    }
  })

cli
  .command('rebase <pr-number>', 'Rebase/retry a pull request by recreating it with latest updates')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--force', 'Force rebase even if PR appears to be up to date')
  .example('buddy-bot rebase 17')
  .example('buddy-bot rebase 17 --verbose')
  .example('buddy-bot rebase 17 --force')
  .action(async (prNumber: string, options: CLIOptions & { force?: boolean }) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      logger.info(`🔄 Rebasing/retrying PR #${prNumber}...`)

      // Check if repository is configured
      if (!config.repository) {
        logger.error('❌ Repository configuration required for PR operations')
        logger.info('Configure repository.provider, repository.owner, repository.name in buddy-bot.config.ts')
        process.exit(1)
      }

      // Get GitHub token from environment (prefer BUDDY_BOT_TOKEN for full permissions)
      const token = process.env.BUDDY_BOT_TOKEN || process.env.GITHUB_TOKEN
      if (!token) {
        logger.error('❌ GITHUB_TOKEN or BUDDY_BOT_TOKEN environment variable required for PR operations')
        process.exit(1)
      }

      const { GitHubProvider } = await import('../src/git/github-provider')
      const hasWorkflowPermissions = !!process.env.BUDDY_BOT_TOKEN
      const gitProvider = new GitHubProvider(
        token,
        config.repository.owner,
        config.repository.name,
        hasWorkflowPermissions,
      )

      const prNum = Number.parseInt(prNumber)
      if (Number.isNaN(prNum)) {
        logger.error('❌ Invalid PR number provided')
        process.exit(1)
      }

      // Get the PR to rebase
      const prs = await gitProvider.getPullRequests('open')
      const pr = prs.find(p => p.number === prNum)

      if (!pr) {
        logger.error(`❌ Could not find open PR #${prNum}`)
        process.exit(1)
      }

      if (!pr.head.startsWith('buddy-bot/')) {
        logger.error(`❌ PR #${prNum} is not a buddy-bot PR (branch: ${pr.head})`)
        process.exit(1)
      }

      logger.info(`📋 Found PR: ${pr.title}`)
      logger.info(`🌿 Branch: ${pr.head}`)

      // Extract package updates from PR body to determine what to update
      const packageUpdates = await extractPackageUpdatesFromPRBody(pr.body)

      if (packageUpdates.length === 0) {
        logger.error('❌ Could not extract package updates from PR body')
        process.exit(1)
      }

      logger.info(`📦 Found ${packageUpdates.length} packages to update`)

      // Check if we need to rebase by scanning for current updates
      if (!options.force) {
        logger.info('🔍 Checking if rebase is needed...')
        const buddy = new Buddy(config)
        const scanResult = await buddy.scanForUpdates()

        // Check if current scan matches PR content
        const currentUpdates = scanResult.updates.filter(u =>
          packageUpdates.some(pu => pu.name === u.name),
        )

        const upToDate = packageUpdates.every(pu =>
          currentUpdates.some(cu =>
            cu.name === pu.name
            && cu.newVersion === pu.newVersion,
          ),
        )

        if (upToDate) {
          logger.success('✅ PR is already up to date, no rebase needed')
          logger.info('💡 Use --force to rebase anyway')
          return
        }
      }

      // Update the existing PR with latest updates (true rebase)
      logger.info('🔄 Updating PR with latest updates...')

      // Get latest updates
      const buddy = new Buddy({
        ...config,
        verbose: options.verbose ?? config.verbose,
      })

      const scanResult = await buddy.scanForUpdates()
      if (scanResult.updates.length === 0) {
        logger.success('✅ All dependencies are now up to date!')
        return
      }

      // Find the matching update group - must match exactly
      const group = scanResult.groups.find(g =>
        g.updates.length === packageUpdates.length
        && g.updates.every(u => packageUpdates.some(pu => pu.name === u.name))
        && packageUpdates.every(pu => g.updates.some(u => u.name === pu.name)),
      )

      if (!group) {
        logger.error('❌ Could not find matching update group. This likely means the package grouping has changed.')
        logger.info(`📋 PR packages: ${packageUpdates.map(p => p.name).join(', ')}`)
        logger.info(`📋 Available groups: ${scanResult.groups.map(g => `${g.name} (${g.updates.length} packages)`).join(', ')}`)
        logger.info(`💡 Close this PR manually and let buddy-bot create new ones with correct grouping`)
        return
      }

      // Generate new file changes (package.json, dependency files, GitHub Actions)
      const packageJsonUpdates = await buddy.generateAllFileUpdates(group.updates)

      // Update the branch with new commits
      await gitProvider.commitChanges(pr.head, group.title, packageJsonUpdates)
      logger.info(`✅ Updated branch ${pr.head} with latest changes`)

      // Generate new PR content
      const { PullRequestGenerator } = await import('../src/pr/pr-generator')
      const prGenerator = new PullRequestGenerator({ verbose: options.verbose })
      const newBody = await prGenerator.generateBody(group)

      // Update the PR with new title/body (and uncheck the rebase box)
      const updatedBody = newBody.replace(
        /- \[x\] <!-- rebase-check -->/g,
        '- [ ] <!-- rebase-check -->',
      )

      await gitProvider.updatePullRequest(prNum, {
        title: group.title,
        body: updatedBody,
      })

      logger.success('🔄 PR rebase completed! Updated existing PR in place.')
    }
    catch (error) {
      logger.error('Rebase failed:', error)
      process.exit(1)
    }
  })

// Helper function to extract package updates from PR body
async function extractPackageUpdatesFromPRBody(body: string): Promise<Array<{ name: string, currentVersion: string, newVersion: string }>> {
  const updates: Array<{ name: string, currentVersion: string, newVersion: string }> = []

  // Match table rows with package updates - handles both npm and Composer formats
  // npm format: | [package] | [`version` -> `version`] |
  // Composer format: | [package](link) | `version` -> `version` | file | status |
  const tableRowRegex = /\|\s*\[([^\]]+)\][^|]*\|\s*\[?`\^?([^`]+)`\s*->\s*`\^?([^`]+)`\]?/g

  let match

  while ((match = tableRowRegex.exec(body)) !== null) {
    const [, packageName, currentVersion, newVersion] = match
    updates.push({
      name: packageName,
      currentVersion,
      newVersion,
    })
  }

  return updates
}

cli
  .command('update-check', 'Check all open buddy-bot PRs for rebase checkbox and auto-rebase if checked')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--dry-run', 'Check but don\'t actually rebase')
  .example('buddy-bot update-check')
  .example('buddy-bot update-check --verbose')
  .example('buddy-bot update-check --dry-run')
  .action(async (options: CLIOptions) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      // Check if repository is configured
      if (!config.repository) {
        logger.error('❌ Repository configuration required for PR operations')
        logger.info('Configure repository.provider, repository.owner, repository.name in buddy-bot.config.ts')
        process.exit(1)
      }

      // Get GitHub token from environment (prefer BUDDY_BOT_TOKEN for full permissions)
      const token = process.env.BUDDY_BOT_TOKEN || process.env.GITHUB_TOKEN
      if (!token) {
        logger.error('❌ GITHUB_TOKEN or BUDDY_BOT_TOKEN environment variable required for PR operations')
        process.exit(1)
      }

      const { GitHubProvider } = await import('../src/git/github-provider')
      const hasWorkflowPermissions = !!process.env.BUDDY_BOT_TOKEN
      const gitProvider = new GitHubProvider(
        token,
        config.repository.owner,
        config.repository.name,
        hasWorkflowPermissions,
      )

      // Step 1: Check for rebase checkboxes using GitHub API (proper body access)
      logger.info('🔍 Checking for PRs with rebase checkbox enabled...')

      let rebasedCount = 0
      let checkedPRs = 0

      try {
        // Get all open PRs via GitHub API to access the raw body
        const openPRs = await gitProvider.getPullRequests('open')

        // Filter to buddy-bot PRs (branches starting with buddy-bot/)
        const buddyBotPRs = openPRs.filter(pr => pr.head.startsWith('buddy-bot/'))

        logger.info(`📋 Found ${buddyBotPRs.length} buddy-bot PRs to check for rebase requests`)

        for (const pr of buddyBotPRs) {
          checkedPRs++
          const hasRebaseChecked = checkRebaseCheckbox(pr.body || '')

          if (hasRebaseChecked) {
            logger.info(`🔄 PR #${pr.number} has rebase checkbox checked`)

            if (options.dryRun) {
              logger.info(`🔍 [DRY RUN] Would rebase PR #${pr.number}`)
              rebasedCount++
            }
            else {
              logger.info(`🔄 Rebasing PR #${pr.number} via rebase command...`)

              try {
                // Use the existing rebase command logic
                const { spawn } = await import('node:child_process')
                const rebaseProcess = spawn('bunx', ['buddy-bot', 'rebase', pr.number.toString()], {
                  stdio: 'inherit',
                  cwd: process.cwd(),
                })

                await new Promise((resolve, reject) => {
                  rebaseProcess.on('close', (code) => {
                    if (code === 0) {
                      rebasedCount++
                      resolve(code)
                    }
                    else {
                      reject(new Error(`Rebase failed with code ${code}`))
                    }
                  })
                })

                logger.success(`✅ Successfully rebased PR #${pr.number}`)
              }
              catch (rebaseError) {
                logger.error(`❌ Failed to rebase PR #${pr.number}:`, rebaseError)
              }
            }
          }
        }

        if (rebasedCount > 0) {
          logger.success(`✅ ${options.dryRun ? 'Would rebase' : 'Successfully rebased'} ${rebasedCount} PR(s)`)
        }
        else if (checkedPRs > 0) {
          logger.info('📋 No PRs have rebase checkbox enabled')
        }
      }
      catch (error) {
        logger.warn('⚠️ Could not check for rebase requests:', error)
      }

      // Step 2: Check for satisfied PRs (dependencies already at target version)
      logger.info('\n✅ Checking for PRs with satisfied dependencies...')
      try {
        const { Buddy } = await import('../src/buddy')
        const buddy = new Buddy(config)
        await buddy.checkAndCloseSatisfiedPRs(gitProvider, !!options.dryRun)
      }
      catch (error) {
        logger.error('⚠️ Could not check for satisfied PRs:', error)
      }

      // Step 3: Check for obsolete PRs (composer files removed, etc.)
      logger.info('\n🔍 Checking for obsolete PRs due to removed dependency files...')
      try {
        const { Buddy } = await import('../src/buddy')
        const buddy = new Buddy(config)
        await buddy.checkAndCloseObsoletePRs(gitProvider, !!options.dryRun)
      }
      catch (error) {
        logger.error('⚠️ Could not check for obsolete PRs:', error)
      }

      // Step 4: Run branch cleanup (uses local git commands, no API calls)
      logger.info('\n🧹 Running branch cleanup...')
      const result = await gitProvider.cleanupStaleBranches(2, !!options.dryRun)

      if (options.dryRun) {
        logger.info(`🔍 [DRY RUN] Would delete ${result.deleted.length} stale branches`)
      }
      else {
        logger.success(`🎉 Cleanup complete: ${result.deleted.length} branches deleted, ${result.failed.length} failed`)
      }

      // Summary
      if (rebasedCount > 0 || result.deleted.length > 0) {
        logger.success(`\n🎉 Update-check complete: ${rebasedCount} PR(s) rebased, ${result.deleted.length} branches cleaned`)
      }
    }
    catch (error) {
      logger.error('update-check failed:', error)
      process.exit(1)
    }
  })

// Helper function to check if rebase checkbox is checked
function checkRebaseCheckbox(body: string): boolean {
  // Look for the checked rebase checkbox pattern - handle both "rebase/retry" and "update/retry"
  // Note: The generated checkbox has a leading space (` - [x]`) so we use \s* to match optional whitespace
  const checkedPattern = /\s*-\s*\[x\]\s*<!--\s*rebase-check\s*-->.*(?:rebase|update)\/retry/i
  return checkedPattern.test(body)
}

cli
  .command('check <packages...>', 'Check specific packages for updates')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--strategy <type>', 'Update strategy: major|minor|patch|all', { default: 'all' })
  .example('buddy-bot check react typescript')
  .example('buddy-bot check react --verbose')
  .action(async (...args: any[]) => {
    // CAC passes individual arguments, then options as the last parameter
    const options: CLIOptions = args[args.length - 1]
    const packages: string[] = args.slice(0, -1)

    const checkLogger = options.verbose ? Logger.verbose() : Logger.quiet()

    if (!packages.length) {
      checkLogger.error('No packages specified to check')
      process.exit(1)
    }

    try {
      checkLogger.info(`Checking specific packages: ${packages.join(', ')}`)

      const finalConfig: BuddyBotConfig = {
        ...config,
        verbose: options.verbose ?? config.verbose,
        packages: {
          ...config.packages,
          strategy: options.strategy ?? config.packages?.strategy ?? 'all',
        },
      }

      const buddy = new Buddy(finalConfig)
      const updates = await buddy.checkPackages(packages)

      if (updates.length === 0) {
        checkLogger.success('All specified packages are up to date!')
      }
      else {
        checkLogger.info(`Found ${updates.length} updates:`)
        for (const update of updates) {
          checkLogger.info(`  ${update.name}: ${update.currentVersion} → ${update.newVersion} (${update.updateType})`)
        }
      }
    }
    catch (error) {
      checkLogger.error('Check failed:', error)
      process.exit(1)
    }
  })

cli
  .command('schedule', 'Run automated dependency updates on schedule')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--strategy <type>', 'Update strategy: major|minor|patch|all', { default: 'all' })
  .example('buddy-bot schedule')
  .example('buddy-bot schedule --verbose')
  .example('buddy-bot schedule --strategy patch')
  .action(async (options: CLIOptions) => {
    const { Scheduler } = await import('../src/scheduler/scheduler')
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      logger.info('🕒 Starting Buddy Scheduler...')

      // Parse ignore list from string if provided
      let ignore: string[] | undefined
      if (options.ignore) {
        ignore = options.ignore.split(',').map(p => p.trim())
      }

      const finalConfig: BuddyBotConfig = {
        ...config,
        verbose: options.verbose ?? config.verbose,
        packages: {
          ...config.packages,
          strategy: options.strategy ?? config.packages?.strategy ?? 'all',
          ignore: ignore ?? config.packages?.ignore,
        },
      }

      // Validate that repository is configured for scheduling
      if (!finalConfig.repository?.provider || !finalConfig.repository?.owner || !finalConfig.repository?.name) {
        logger.error('❌ Repository configuration required for scheduling. Please configure:')
        logger.info('  - repository.provider (github, gitlab, etc.)')
        logger.info('  - repository.owner')
        logger.info('  - repository.name')
        logger.info('  - repository.token (via environment variable)')
        process.exit(1)
      }

      const scheduler = new Scheduler(options.verbose)
      const job = Scheduler.createJobFromConfig(finalConfig, 'cli-schedule')

      // Override cron if provided
      if (options.strategy) {
        switch (options.strategy) {
          case 'major':
            job.schedule.cron = Scheduler.PRESETS.WEEKLY
            break
          case 'minor':
            job.schedule.cron = Scheduler.PRESETS.TWICE_WEEKLY
            break
          case 'patch':
            job.schedule.cron = Scheduler.PRESETS.DAILY
            break
          default:
            job.schedule.cron = Scheduler.PRESETS.WEEKLY
        }
      }

      scheduler.addJob(job)
      scheduler.start()

      logger.success(`✅ Scheduler started with cron: ${job.schedule.cron}`)
      logger.info('📅 Next run:', job.nextRun?.toISOString() || 'Unknown')
      logger.info('🛑 Press Ctrl+C to stop the scheduler')

      // Keep process alive
      process.stdin.resume()
    }
    catch (error) {
      logger.error('Scheduler failed:', error)
      process.exit(1)
    }
  })

cli
  .command('generate-workflows', 'Generate GitHub Actions workflow templates (deprecated - use "setup" instead)')
  .option('--verbose, -v', 'Enable verbose logging')
  .example('buddy-bot generate-workflows')
  .example('buddy-bot generate-workflows --verbose')
  .action(async (options: CLIOptions) => {
    const { GitHubActionsTemplate } = await import('../src/templates/github-actions')
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    console.log('⚠️  The "generate-workflows" command is deprecated.')
    console.log('💡 Use "buddy-bot setup" for a better interactive experience.\n')

    try {
      const finalConfig: BuddyBotConfig = {
        ...config,
        verbose: options.verbose ?? config.verbose,
      }

      const outputDir = finalConfig.workflows?.outputDir
        ? resolve(process.cwd(), finalConfig.workflows.outputDir)
        : resolve(process.cwd(), '.github', 'workflows')

      logger.info('🚀 Generating GitHub Actions workflow templates...')

      // Create output directory
      try {
        mkdirSync(outputDir, { recursive: true })
      }
      catch {
        // Directory already exists
      }

      // Generate workflows based on configuration
      const templates = finalConfig.workflows?.templates || {
        comprehensive: true,
        daily: true,
        weekly: true,
        monthly: true,
        docker: true,
        monorepo: true,
      }

      let generatedCount = 0

      // Generate standard scheduled workflows
      if (templates.daily || templates.weekly || templates.monthly) {
        const workflows = GitHubActionsTemplate.generateScheduledWorkflows(finalConfig)

        for (const [filename, content] of Object.entries(workflows)) {
          const shouldGenerate = (
            (filename.includes('daily') && templates.daily)
            || (filename.includes('weekly') && templates.weekly)
            || (filename.includes('monthly') && templates.monthly)
          )

          if (shouldGenerate) {
            const filepath = resolve(outputDir, filename)
            writeFileSync(filepath, content)
            logger.success(`Generated: ${filename}`)
            generatedCount++
          }
        }
      }

      // Generate comprehensive workflow
      if (templates.comprehensive) {
        const comprehensiveWorkflow = GitHubActionsTemplate.generateComprehensiveWorkflow(finalConfig)
        writeFileSync(resolve(outputDir, 'buddy-comprehensive.yml'), comprehensiveWorkflow)
        logger.success('Generated: buddy-comprehensive.yml')
        generatedCount++
      }

      // Generate specialized workflows
      if (templates.docker) {
        const dockerWorkflow = GitHubActionsTemplate.generateDockerWorkflow(finalConfig)
        writeFileSync(resolve(outputDir, 'buddy-docker.yml'), dockerWorkflow)
        logger.success('Generated: buddy-docker.yml')
        generatedCount++
      }

      if (templates.monorepo) {
        const monorepoWorkflow = GitHubActionsTemplate.generateMonorepoWorkflow(finalConfig)
        writeFileSync(resolve(outputDir, 'buddy-monorepo.yml'), monorepoWorkflow)
        logger.success('Generated: buddy-monorepo.yml')
        generatedCount++
      }

      // Generate custom workflows
      if (finalConfig.workflows?.custom?.length) {
        for (const customWorkflow of finalConfig.workflows.custom) {
          const workflowContent = GitHubActionsTemplate.generateCustomWorkflow(customWorkflow, finalConfig)
          const filename = `buddy-${customWorkflow.name.toLowerCase().replace(/\s+/g, '-')}.yml`
          writeFileSync(resolve(outputDir, filename), workflowContent)
          logger.success(`Generated: ${filename}`)
          generatedCount++
        }
      }

      if (generatedCount === 0) {
        logger.warn('No workflows were generated. Check your configuration in buddy-bot.config.ts')
        logger.info('Set workflows.templates to enable specific templates or add custom workflows.')
        return
      }

      logger.success(`\n🎉 ${generatedCount} GitHub Actions workflow(s) generated!`)
      logger.info(`📁 Location: ${outputDir}`)
      logger.info('\n💡 Next steps:')
      logger.info('  1. Review and customize the workflows for your project')
      logger.info('  2. Ensure GITHUB_TOKEN is available as a secret')
      logger.info('  3. Configure buddy-bot.config.ts with your repository settings')
      logger.info('  4. Enable GitHub Actions in your repository settings')
      logger.info('\n🔗 Learn more: https://docs.github.com/en/actions')
    }
    catch (error) {
      logger.error('Failed to generate workflows:', error)
      process.exit(1)
    }
  })

cli
  .command('info <package>', 'Show detailed package information')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--json', 'Output in JSON format')
  .example('buddy-bot info react')
  .example('buddy-bot info react --json')
  .example('buddy-bot info typescript@latest')
  .action(async (packageName: string, options: CLIOptions & { json?: boolean }) => {
    const { RegistryClient } = await import('../src/registry/registry-client')
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      const registryClient = new RegistryClient(process.cwd(), logger, undefined)

      if (options.json) {
        // Output raw JSON from bun info
        const { spawn } = await import('node:child_process')
        const child = spawn('bun', ['info', packageName, '--json'], {
          stdio: 'inherit',
        })

        child.on('close', (code) => {
          process.exit(code || 0)
        })
        return
      }

      // Get package metadata and display in a nice format
      const metadata = await registryClient.getPackageMetadata(packageName)

      if (!metadata) {
        logger.error(`Package "${packageName}" not found or failed to fetch metadata`)
        process.exit(1)
      }

      console.log(`📦 ${metadata.name}@${metadata.latestVersion}`)

      if (metadata.description) {
        console.log(`📝 ${metadata.description}`)
      }

      if (metadata.homepage) {
        console.log(`🌐 ${metadata.homepage}`)
      }

      if (metadata.repository) {
        console.log(`📁 ${metadata.repository}`)
      }

      if (metadata.license) {
        console.log(`⚖️  License: ${metadata.license}`)
      }

      if (metadata.author) {
        console.log(`👤 Author: ${metadata.author}`)
      }

      if (metadata.keywords && metadata.keywords.length > 0) {
        console.log(`🏷️  Keywords: ${metadata.keywords.join(', ')}`)
      }

      const depCounts = {
        deps: Object.keys(metadata.dependencies || {}).length,
        devDeps: Object.keys(metadata.devDependencies || {}).length,
        peerDeps: Object.keys(metadata.peerDependencies || {}).length,
      }

      console.log(`📊 Dependencies: ${depCounts.deps} | Dev: ${depCounts.devDeps} | Peer: ${depCounts.peerDeps}`)

      if (metadata.versions && metadata.versions.length > 1) {
        console.log(`📈 ${metadata.versions.length} versions available`)

        if (options.verbose && metadata.versions.length <= 10) {
          console.log(`   Latest versions: ${metadata.versions.slice(-5).join(', ')}`)
        }
      }
    }
    catch (error) {
      logger.error('Failed to get package info:', error)
      process.exit(1)
    }
  })

cli
  .command('versions <package>', 'Show all available versions of a package')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--latest <count>', 'Show only the latest N versions', { default: '10' })
  .example('buddy-bot versions react')
  .example('buddy-bot versions react --latest 5')
  .action(async (packageName: string, options: CLIOptions & { latest?: string }) => {
    const { RegistryClient } = await import('../src/registry/registry-client')
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      const registryClient = new RegistryClient(process.cwd(), logger, undefined)
      const metadata = await registryClient.getPackageMetadata(packageName)

      if (!metadata) {
        logger.error(`Package "${packageName}" not found`)
        process.exit(1)
      }

      const latestCount = Number.parseInt(options.latest || '10', 10)

      console.log(`📦 ${metadata.name} - Available Versions`)
      console.log(`📈 Total: ${metadata.versions?.length || 0} versions`)
      console.log(`⭐ Latest: ${metadata.latestVersion}`)

      if (metadata.versions && metadata.versions.length > 0) {
        console.log('\n📋 Recent versions:')
        const versionsToShow = metadata.versions.slice(-latestCount).reverse()

        versionsToShow.forEach((version, _index) => {
          const isLatest = version === metadata.latestVersion
          const prefix = isLatest ? '⭐' : '  '
          console.log(`${prefix} ${version}`)
        })

        if (metadata.versions.length > latestCount) {
          console.log(`   ... and ${metadata.versions.length - latestCount} older versions`)
        }
      }
    }
    catch (error) {
      logger.error('Failed to get package versions:', error)
      process.exit(1)
    }
  })

cli
  .command('exists <package>', 'Check if a package exists in the registry')
  .option('--verbose, -v', 'Enable verbose logging')
  .example('buddy-bot exists react')
  .example('buddy-bot exists nonexistent-package-xyz')
  .action(async (packageName: string, options: CLIOptions) => {
    const { RegistryClient } = await import('../src/registry/registry-client')
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      const registryClient = new RegistryClient(process.cwd(), logger, undefined)
      const exists = await registryClient.packageExists(packageName)

      if (exists) {
        console.log(`✅ Package "${packageName}" exists in the registry`)
        process.exit(0)
      }
      else {
        console.log(`❌ Package "${packageName}" does not exist in the registry`)
        process.exit(1)
      }
    }
    catch (error) {
      logger.error('Failed to check package existence:', error)
      process.exit(1)
    }
  })

cli
  .command('latest <package>', 'Get the latest version of a package')
  .option('--verbose, -v', 'Enable verbose logging')
  .example('buddy-bot latest react')
  .example('buddy-bot latest @types/node')
  .action(async (packageName: string, options: CLIOptions) => {
    const { RegistryClient } = await import('../src/registry/registry-client')
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      const registryClient = new RegistryClient(process.cwd(), logger, undefined)
      const latestVersion = await registryClient.getLatestVersion(packageName)

      if (latestVersion) {
        console.log(`📦 ${packageName}@${latestVersion}`)
      }
      else {
        logger.error(`Package "${packageName}" not found`)
        process.exit(1)
      }
    }
    catch (error) {
      logger.error('Failed to get latest version:', error)
      process.exit(1)
    }
  })

cli
  .command('deps <package>', 'Show dependencies of a package')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--dev', 'Show dev dependencies')
  .option('--peer', 'Show peer dependencies')
  .option('--all', 'Show all dependency types')
  .example('buddy-bot deps react')
  .example('buddy-bot deps react --dev')
  .example('buddy-bot deps react --all')
  .action(async (packageName: string, options: CLIOptions & { dev?: boolean, peer?: boolean, all?: boolean }) => {
    const { RegistryClient } = await import('../src/registry/registry-client')
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      const registryClient = new RegistryClient(process.cwd(), logger, undefined)
      const metadata = await registryClient.getPackageMetadata(packageName)

      if (!metadata) {
        logger.error(`Package "${packageName}" not found`)
        process.exit(1)
      }

      console.log(`📦 ${metadata.name}@${metadata.latestVersion} - Dependencies`)

      const showProd = !options.dev && !options.peer
      const showDev = options.dev || options.all
      const showPeer = options.peer || options.all

      if (showProd || options.all) {
        const deps = metadata.dependencies || {}
        const depCount = Object.keys(deps).length

        console.log(`\n📋 Production Dependencies (${depCount}):`)
        if (depCount > 0) {
          Object.entries(deps).forEach(([name, version]) => {
            console.log(`  ${name}: ${version}`)
          })
        }
        else {
          console.log('  No production dependencies')
        }
      }

      if (showDev) {
        const devDeps = metadata.devDependencies || {}
        const devDepCount = Object.keys(devDeps).length

        console.log(`\n🛠️  Dev Dependencies (${devDepCount}):`)
        if (devDepCount > 0) {
          Object.entries(devDeps).forEach(([name, version]) => {
            console.log(`  ${name}: ${version}`)
          })
        }
        else {
          console.log('  No dev dependencies')
        }
      }

      if (showPeer) {
        const peerDeps = metadata.peerDependencies || {}
        const peerDepCount = Object.keys(peerDeps).length

        console.log(`\n🤝 Peer Dependencies (${peerDepCount}):`)
        if (peerDepCount > 0) {
          Object.entries(peerDeps).forEach(([name, version]) => {
            console.log(`  ${name}: ${version}`)
          })
        }
        else {
          console.log('  No peer dependencies')
        }
      }
    }
    catch (error) {
      logger.error('Failed to get package dependencies:', error)
      process.exit(1)
    }
  })

cli
  .command('compare <package> <version1> <version2>', 'Compare two versions of a package')
  .option('--verbose, -v', 'Enable verbose logging')
  .example('buddy-bot compare react 17.0.0 18.0.0')
  .example('buddy-bot compare typescript 4.9.0 5.0.0')
  .action(async (packageName: string, version1: string, version2: string, options: CLIOptions) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      console.log(`📊 Comparing ${packageName}: ${version1} vs ${version2}`)

      // Get package metadata to validate versions exist
      const { RegistryClient } = await import('../src/registry/registry-client')
      const registryClient = new RegistryClient(process.cwd(), logger, undefined)
      const metadata = await registryClient.getPackageMetadata(packageName)

      if (!metadata) {
        logger.error(`Package "${packageName}" not found`)
        process.exit(1)
      }

      const availableVersions = metadata.versions || []

      if (!availableVersions.includes(version1)) {
        console.log(`⚠️  Version ${version1} not found in available versions`)
      }

      if (!availableVersions.includes(version2)) {
        console.log(`⚠️  Version ${version2} not found in available versions`)
      }

      // Basic version comparison using semver-like logic
      const { getUpdateType } = await import('../src/utils/helpers')
      const updateType = getUpdateType(version1, version2)

      console.log(`\n🔍 Version Analysis:`)
      console.log(`   From: ${version1}`)
      console.log(`   To:   ${version2}`)
      console.log(`   Type: ${updateType} update`)

      // Show version position in the list
      const v1Index = availableVersions.indexOf(version1)
      const v2Index = availableVersions.indexOf(version2)

      if (v1Index !== -1 && v2Index !== -1) {
        const versionsBetween = Math.abs(v2Index - v1Index) - 1
        console.log(`   Gap:  ${versionsBetween} versions between them`)

        if (v2Index > v1Index) {
          console.log(`   📈 ${version2} is newer than ${version1}`)
        }
        else {
          console.log(`   📉 ${version2} is older than ${version1}`)
        }
      }

      console.log(`\n💡 Use 'buddy-bot versions ${packageName}' to see all available versions`)
      console.log(`💡 Use 'buddy-bot info ${packageName}' for detailed package information`)
    }
    catch (error) {
      logger.error('Failed to compare versions:', error)
      process.exit(1)
    }
  })

cli
  .command('search <query>', 'Search for packages in the registry')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--limit <count>', 'Limit number of results', { default: '10' })
  .example('buddy-bot search react')
  .example('buddy-bot search "test framework" --limit 5')
  .action(async (query: string, options: CLIOptions & { limit?: string }) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      const { spawn } = await import('node:child_process')
      const limit = Number.parseInt(options.limit || '10', 10)

      console.log(`🔍 Searching for: "${query}"`)
      console.log(`📊 Showing top ${limit} results\n`)

      // Check if npm is available first
      const checkNpm = spawn('which', ['npm'], { stdio: 'pipe' })

      checkNpm.on('close', async (code) => {
        if (code !== 0) {
          // npm not available, use registry API search
          console.log('📡 Using npm registry API search...')
          try {
            const { RegistryClient } = await import('../src/registry/registry-client')
            const registryClient = new RegistryClient(process.cwd(), logger, undefined)
            const results = await registryClient.searchPackages(query, limit)

            if (results.length === 0) {
              console.log(`❌ No packages found for "${query}"`)
              console.log('💡 Try different search terms or browse https://www.npmjs.com')
              return
            }

            results.forEach((pkg, index) => {
              console.log(`${index + 1}. 📦 ${pkg.name}@${pkg.version}`)
              if (pkg.description) {
                console.log(`   📝 ${pkg.description}`)
              }
              if (pkg.keywords && pkg.keywords.length > 0) {
                console.log(`   🏷️  ${pkg.keywords.slice(0, 3).join(', ')}${pkg.keywords.length > 3 ? '...' : ''}`)
              }
              console.log()
            })

            console.log(`✨ Use 'buddy-bot info <package>' for detailed information`)
          }
          catch {
            console.log('❌ Registry API search failed')
            console.log('💡 Alternative search options:')
            console.log(`   • Visit https://www.npmjs.com/search?q=${encodeURIComponent(query)}`)
            console.log('   • Use: bun add <package-name> to test if a package exists')
            console.log('   • Use: buddy-bot exists <package-name> to check existence')
          }
          return
        }

        // npm is available, proceed with search
        const child = spawn('npm', ['search', query, '--json'], {
          stdio: 'pipe',
        })

        let output = ''
        child.stdout?.on('data', (data) => {
          output += data.toString()
        })

        child.stderr?.on('data', (data) => {
          if (options.verbose) {
            logger.warn('npm search stderr:', data.toString())
          }
        })

        child.on('close', (code) => {
          if (code === 0) {
            try {
              const results = JSON.parse(output)
              const limitedResults = results.slice(0, limit)

              if (limitedResults.length === 0) {
                console.log(`❌ No packages found for "${query}"`)
                console.log('💡 Try different search terms or browse https://www.npmjs.com')
                return
              }

              limitedResults.forEach((pkg: any, index: number) => {
                console.log(`${index + 1}. 📦 ${pkg.name}@${pkg.version}`)
                if (pkg.description) {
                  console.log(`   📝 ${pkg.description}`)
                }
                if (pkg.keywords && pkg.keywords.length > 0) {
                  console.log(`   🏷️  ${pkg.keywords.slice(0, 3).join(', ')}${pkg.keywords.length > 3 ? '...' : ''}`)
                }
                console.log()
              })

              console.log(`✨ Use 'buddy-bot info <package>' for detailed information`)
            }
            catch (error) {
              logger.error('Failed to parse search results:', error)
              console.log(`💡 Try searching at https://www.npmjs.com/search?q=${encodeURIComponent(query)}`)
            }
          }
          else {
            console.log('❌ Search failed')
            console.log(`💡 Try searching at https://www.npmjs.com/search?q=${encodeURIComponent(query)}`)
          }
        })
      })
    }
    catch (error) {
      logger.error('Failed to search packages:', error)
      console.log(`💡 Try searching at https://www.npmjs.com/search?q=${encodeURIComponent(query)}`)
    }
  })

cli
  .command('cleanup', 'Clean up stale buddy-bot branches that don\'t have associated open PRs')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--dry-run', 'Show what would be deleted without actually deleting')
  .option('--days <number>', 'Delete branches older than N days (default: 7)', { default: '7' })
  .option('--force', 'Force cleanup without confirmation prompt')
  .example('buddy-bot cleanup')
  .example('buddy-bot cleanup --dry-run')
  .example('buddy-bot cleanup --days 14')
  .example('buddy-bot cleanup --force')
  .action(async (options: CLIOptions & { dryRun?: boolean, days?: string, force?: boolean }) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      logger.info('🧹 Starting buddy-bot branch cleanup...')

      // Check if repository is configured
      if (!config.repository) {
        logger.error('❌ Repository configuration required for branch cleanup')
        logger.info('Configure repository.provider, repository.owner, repository.name in buddy-bot.config.ts')
        process.exit(1)
      }

      // Get GitHub token from environment
      const token = process.env.BUDDY_BOT_TOKEN || process.env.GITHUB_TOKEN
      if (!token) {
        logger.error('❌ GITHUB_TOKEN or BUDDY_BOT_TOKEN environment variable required for branch operations')
        process.exit(1)
      }

      const { GitHubProvider } = await import('../src/git/github-provider')
      const hasWorkflowPermissions = !!process.env.BUDDY_BOT_TOKEN
      const gitProvider = new GitHubProvider(
        token,
        config.repository.owner,
        config.repository.name,
        hasWorkflowPermissions,
      )

      const days = Number.parseInt(options.days || '7', 10)
      if (Number.isNaN(days) || days < 1) {
        logger.error('❌ Invalid days value. Must be a positive number.')
        process.exit(1)
      }

      logger.info(`🔍 Looking for buddy-bot branches older than ${days} days...`)

      // Get all orphaned branches
      const orphanedBranches = await gitProvider.getOrphanedBuddyBotBranches()
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - days)
      const staleBranches = orphanedBranches.filter(branch => branch.lastCommitDate < cutoffDate)

      if (staleBranches.length === 0) {
        logger.success('✅ No stale branches found!')
        logger.info(`📊 Total buddy-bot branches: ${orphanedBranches.length}`)
        logger.info(`📊 Stale branches (>${days} days): 0`)
        return
      }

      logger.info(`📊 Found ${staleBranches.length} stale branches to clean up:`)
      staleBranches.forEach((branch) => {
        const daysOld = Math.floor((Date.now() - branch.lastCommitDate.getTime()) / (1000 * 60 * 60 * 24))
        logger.info(`  - ${branch.name} (${daysOld} days old)`)
      })

      if (options.dryRun) {
        logger.info('\n🔍 [DRY RUN] These branches would be deleted')
        logger.info('💡 Run without --dry-run to actually delete them')
        return
      }

      // Confirmation prompt (unless --force is used)
      if (!options.force) {
        const response = await prompts({
          type: 'confirm',
          name: 'confirmed',
          message: `Are you sure you want to delete ${staleBranches.length} stale branches?`,
          initial: false,
        })

        if (!response.confirmed) {
          logger.info('❌ Cleanup cancelled')
          return
        }
      }

      // Perform cleanup
      const result = await gitProvider.cleanupStaleBranches(days, false)

      if (result.deleted.length > 0) {
        logger.success(`✅ Successfully deleted ${result.deleted.length} stale branches`)
      }

      if (result.failed.length > 0) {
        logger.warn(`⚠️ Failed to delete ${result.failed.length} branches`)
        result.failed.forEach(branch => logger.warn(`  - ${branch}`))
      }

      logger.info(`\n📊 Cleanup Summary:`)
      logger.info(`  ✅ Deleted: ${result.deleted.length}`)
      logger.info(`  ❌ Failed: ${result.failed.length}`)
      logger.info(`  📊 Total processed: ${staleBranches.length}`)
    }
    catch (error) {
      logger.error('Branch cleanup failed:', error)
      process.exit(1)
    }
  })

cli
  .command('list-branches', 'List all buddy-bot branches and their status')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--orphaned-only', 'Show only branches without associated open PRs')
  .option('--stale-only', 'Show only stale branches (older than 7 days)')
  .option('--days <number>', 'Define stale threshold in days (default: 7)', { default: '7' })
  .example('buddy-bot list-branches')
  .example('buddy-bot list-branches --orphaned-only')
  .example('buddy-bot list-branches --stale-only --days 14')
  .action(async (options: CLIOptions & { orphanedOnly?: boolean, staleOnly?: boolean, days?: string }) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      logger.info('📋 Listing buddy-bot branches...')

      // Check if repository is configured
      if (!config.repository) {
        logger.error('❌ Repository configuration required for branch listing')
        logger.info('Configure repository.provider, repository.owner, repository.name in buddy-bot.config.ts')
        process.exit(1)
      }

      // Get GitHub token from environment
      const token = process.env.BUDDY_BOT_TOKEN || process.env.GITHUB_TOKEN
      if (!token) {
        logger.error('❌ GITHUB_TOKEN or BUDDY_BOT_TOKEN environment variable required for branch operations')
        process.exit(1)
      }

      const { GitHubProvider } = await import('../src/git/github-provider')
      const hasWorkflowPermissions = !!process.env.BUDDY_BOT_TOKEN
      const gitProvider = new GitHubProvider(
        token,
        config.repository.owner,
        config.repository.name,
        hasWorkflowPermissions,
      )

      const days = Number.parseInt(options.days || '7', 10)
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - days)

      // Get all branches and PRs
      const [allBuddyBranches, openPRs] = await Promise.all([
        gitProvider.getBuddyBotBranches(),
        gitProvider.getPullRequests('open'),
      ])

      const prBranches = new Set(openPRs.map(pr => pr.head))

      // Filter branches based on options
      let branches = allBuddyBranches
      if (options.orphanedOnly) {
        branches = branches.filter(branch => !prBranches.has(branch.name))
      }
      if (options.staleOnly) {
        branches = branches.filter(branch => branch.lastCommitDate < cutoffDate && !prBranches.has(branch.name))
      }

      if (branches.length === 0) {
        if (options.orphanedOnly && options.staleOnly) {
          logger.success('✅ No stale orphaned branches found!')
        }
        else if (options.orphanedOnly) {
          logger.success('✅ No orphaned branches found!')
        }
        else if (options.staleOnly) {
          logger.success('✅ No stale branches found!')
        }
        else {
          logger.info('📋 No buddy-bot branches found')
        }
        return
      }

      console.log(`\n📊 Found ${branches.length} buddy-bot branch${branches.length !== 1 ? 'es' : ''}:\n`)

      // Sort by last commit date (newest first)
      branches.sort((a, b) => b.lastCommitDate.getTime() - a.lastCommitDate.getTime())

      branches.forEach((branch) => {
        const hasOpenPR = prBranches.has(branch.name)
        const daysOld = Math.floor((Date.now() - branch.lastCommitDate.getTime()) / (1000 * 60 * 60 * 24))
        const isStale = branch.lastCommitDate < cutoffDate

        const status = hasOpenPR ? '🔴 Open PR' : (isStale ? '🟡 Stale' : '🟢 Recent')
        const shortSha = branch.sha.substring(0, 7)

        console.log(`${status} ${branch.name}`)
        console.log(`    📅 ${daysOld} days old | 📝 ${shortSha} | 🗓️  ${branch.lastCommitDate.toISOString().split('T')[0]}`)
        console.log()
      })

      // Summary
      const orphanedCount = branches.filter(branch => !prBranches.has(branch.name)).length
      const staleCount = branches.filter(branch => branch.lastCommitDate < cutoffDate && !prBranches.has(branch.name)).length

      console.log('📊 Summary:')
      console.log(`  📋 Total buddy-bot branches: ${allBuddyBranches.length}`)
      console.log(`  🔴 With open PRs: ${allBuddyBranches.length - orphanedCount}`)
      console.log(`  🟡 Orphaned: ${orphanedCount}`)
      console.log(`  🗑️  Stale (>${days} days): ${staleCount}`)

      if (staleCount > 0) {
        console.log(`\n💡 Run 'buddy-bot cleanup' to clean up stale branches`)
      }
    }
    catch (error) {
      logger.error('Branch listing failed:', error)
      process.exit(1)
    }
  })

cli
  .command('open-settings', 'Open GitHub repository and organization settings pages')
  .option('--verbose, -v', 'Enable verbose logging')
  .example('buddy-bot open-settings')
  .action(async (options: CLIOptions) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      const { exec } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execAsync = promisify(exec)

      // Try to get repository info from config
      let owner = config.repository?.owner
      let name = config.repository?.name

      // If not in config, try to detect from git remote
      if (!owner || !name) {
        try {
          const { stdout } = await execAsync('git remote get-url origin')
          const remoteUrl = stdout.trim()

          // Parse GitHub URL (supports both HTTPS and SSH)
          const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+)(?:\.git)?/)
          if (match) {
            owner = match[1]
            name = match[2]
            logger.info(`📡 Detected repository: ${owner}/${name}`)
          }
        }
        catch {
          // Ignore git errors
        }
      }

      if (!owner || !name) {
        logger.warn('⚠️  Could not determine repository information.')
        logger.info('💡 Please configure repository settings in buddy-bot.config.ts or run from a Git repository.')
        logger.info('\nFor manual setup, visit:')
        logger.info('🔗 Repository settings: https://github.com/YOUR_ORG/YOUR_REPO/settings/actions')
        logger.info('🔗 Organization settings: https://github.com/organizations/YOUR_ORG/settings/actions')
        return
      }

      // Open repository settings page
      const repoUrl = `https://github.com/${owner}/${name}/settings/actions`
      const orgUrl = `https://github.com/organizations/${owner}/settings/actions`

      logger.info('🔧 Opening GitHub Actions settings pages...')
      logger.info(`📦 Repository: ${owner}/${name}`)

      // Function to open URL cross-platform
      const openUrl = async (url: string, description: string) => {
        try {
          let command: string

          switch (process.platform) {
            case 'darwin': // macOS
              command = `open "${url}"`
              break
            case 'win32': // Windows
              command = `start "" "${url}"`
              break
            default: // Linux and others
              command = `xdg-open "${url}"`
          }

          await execAsync(command)
          logger.success(`✅ Opened ${description}: ${url}`)
        }
        catch {
          logger.warn(`⚠️  Could not auto-open ${description}. Please visit manually:`)
          logger.info(`🔗 ${url}`)
        }
      }

      // Open repository settings
      await openUrl(repoUrl, 'repository settings')

      // Also try to open organization settings (may fail if not an org)
      setTimeout(async () => {
        logger.info('\n🏢 Attempting to open organization settings...')
        await openUrl(orgUrl, 'organization settings')

        logger.info('\n📋 Required Settings:')
        logger.info('  1. Under "Workflow permissions":')
        logger.info('     ✅ Select "Read and write permissions"')
        logger.info('     ✅ Check "Allow GitHub Actions to create and approve pull requests"')
        logger.info('  2. Click "Save"')
        logger.info('\n💡 Note: Organization settings may override repository settings.')
      }, 1000) // Delay to avoid opening both simultaneously
    }
    catch (error) {
      logger.error('Failed to open settings:', error)
      logger.info('\n📋 Manual Setup:')
      logger.info('🔗 Repository: https://github.com/YOUR_ORG/YOUR_REPO/settings/actions')
      logger.info('🔗 Organization: https://github.com/organizations/YOUR_ORG/settings/actions')
    }
  })

cli.command('version', 'Show the version of Buddy Bot').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
