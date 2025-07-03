import type { BuddyBotConfig } from '../types'
import process from 'node:process'
import { Buddy } from '../buddy'
import { config } from '../config'
import { Logger } from '../utils/logger'

export interface CLIOptions {
  verbose?: boolean
  config?: string
  packages?: string[]
  pattern?: string
  strategy?: 'major' | 'minor' | 'patch' | 'all'
  ignore?: string[]
  dryRun?: boolean
}

export function createCLI(): {
  'scan': typeof scanCommand
  'update': typeof updateCommand
  'check': typeof checkCommand
  'schedule': typeof scheduleCommand
  'generate-workflows': typeof generateWorkflowsCommand
  'help': typeof helpCommand
} {
  return {
    'scan': scanCommand,
    'update': updateCommand,
    'check': checkCommand,
    'schedule': scheduleCommand,
    'generate-workflows': generateWorkflowsCommand,
    'help': helpCommand,
  }
}

/**
 * Scan for dependency updates
 */
export async function scanCommand(options: CLIOptions = {}): Promise<void> {
  const logger = options.verbose ? Logger.verbose() : Logger.quiet()

  try {
    logger.info('Loading configuration...')

    // Override config with CLI options
    const finalConfig: BuddyBotConfig = {
      ...config,
      verbose: options.verbose ?? config.verbose,
      packages: {
        ...config.packages,
        strategy: options.strategy ?? config.packages?.strategy ?? 'all',
        ignore: options.ignore ?? config.packages?.ignore,
      },
    }

    const buddy = new Buddy(finalConfig)

    if (options.packages?.length) {
      logger.info(`Checking specific packages: ${options.packages.join(', ')}`)
      const updates = await buddy.checkPackages(options.packages)

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
}

/**
 * Update dependencies and create PRs
 */
export async function updateCommand(options: CLIOptions = {}): Promise<void> {
  const logger = options.verbose ? Logger.verbose() : Logger.quiet()

  try {
    logger.info('Starting dependency update process...')

    const finalConfig: BuddyBotConfig = {
      ...config,
      verbose: options.verbose ?? config.verbose,
      packages: {
        ...config.packages,
        strategy: options.strategy ?? config.packages?.strategy ?? 'all',
        ignore: options.ignore ?? config.packages?.ignore,
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
}

/**
 * Check specific packages for updates
 */
export async function checkCommand(packages: string[], options: CLIOptions = {}): Promise<void> {
  const logger = options.verbose ? Logger.verbose() : Logger.quiet()

  if (!packages.length) {
    logger.error('No packages specified to check')
    process.exit(1)
  }

  await scanCommand({ ...options, packages })
}

/**
 * Run the scheduler for automated dependency updates
 */
export async function scheduleCommand(options: CLIOptions = {}): Promise<void> {
  const { Scheduler } = await import('../scheduler/scheduler')
  const logger = options.verbose ? Logger.verbose() : Logger.quiet()

  try {
    logger.info('🕒 Starting Buddy Scheduler...')

    const finalConfig: BuddyBotConfig = {
      ...config,
      verbose: options.verbose ?? config.verbose,
      packages: {
        ...config.packages,
        strategy: options.strategy ?? config.packages?.strategy ?? 'all',
        ignore: options.ignore ?? config.packages?.ignore,
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
}

/**
 * Generate GitHub Actions workflows
 */
export async function generateWorkflowsCommand(options: CLIOptions = {}): Promise<void> {
  const { GitHubActionsTemplate } = await import('../templates/github-actions')
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const logger = options.verbose ? Logger.verbose() : Logger.quiet()

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
          (filename.includes('daily') && templates.daily) ||
          (filename.includes('weekly') && templates.weekly) ||
          (filename.includes('monthly') && templates.monthly)
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
}

/**
 * Parse CLI arguments and run appropriate command
 */
export async function runCLI(args: string[]): Promise<void> {
  const [command, ...rest] = args
  const options = parseOptions(rest)

  switch (command) {
    case 'scan':
      await scanCommand(options)
      break
    case 'update':
      await updateCommand(options)
      break
    case 'check':
      await checkCommand(options.packages || [], options)
      break
    case 'schedule':
      await scheduleCommand(options)
      break
    case 'generate-workflows':
      await generateWorkflowsCommand(options)
      break
    default:
      console.error(`Unknown command: ${command}`)
      console.error('Run "buddy help" for usage information')
      process.exit(1)
  }
}

/**
 * Parse command line options
 */
function parseOptions(args: string[]): CLIOptions {
  const options: CLIOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--verbose':
      case '-v':
        options.verbose = true
        break
      case '--config':
        options.config = args[++i]
        break
      case '--packages':
        options.packages = args[++i]?.split(',').map(p => p.trim()) || []
        break
      case '--pattern':
        options.pattern = args[++i]
        break
      case '--strategy':
        options.strategy = args[++i] as any
        break
      case '--ignore':
        options.ignore = args[++i]?.split(',').map(p => p.trim()) || []
        break
      case '--dry-run':
        options.dryRun = true
        break
    }
  }

  return options
}
