import type { BuddyBotConfig } from '../types'
import { Buddy } from '../buddy'
import { ConfigManager } from '../config/config-manager'
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
  scan: typeof scanCommand
  update: typeof updateCommand
  check: typeof checkCommand
  help: typeof helpCommand
} {
  return {
    scan: scanCommand,
    update: updateCommand,
    check: checkCommand,
    help: helpCommand
  }
}

/**
 * Scan for dependency updates
 */
export async function scanCommand(options: CLIOptions = {}): Promise<void> {
  const logger = options.verbose ? Logger.verbose() : Logger.quiet()

  try {
    logger.info('Loading configuration...')
    const baseConfig = await ConfigManager.loadConfig()

    // Override config with CLI options
    const config: BuddyBotConfig = {
      ...baseConfig,
      verbose: options.verbose ?? baseConfig.verbose,
      packages: {
        ...baseConfig.packages,
        strategy: options.strategy ?? baseConfig.packages?.strategy ?? 'all',
        ignore: options.ignore ?? baseConfig.packages?.ignore
      }
    }

    const buddy = new Buddy(config)

    if (options.packages?.length) {
      logger.info(`Checking specific packages: ${options.packages.join(', ')}`)
      const updates = await buddy.checkPackages(options.packages)

      if (updates.length === 0) {
        logger.success('All specified packages are up to date!')
      } else {
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
      } else {
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

  } catch (error) {
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

    const baseConfig = await ConfigManager.loadConfig()
    const config: BuddyBotConfig = {
      ...baseConfig,
      verbose: options.verbose ?? baseConfig.verbose,
      packages: {
        ...baseConfig.packages,
        strategy: options.strategy ?? baseConfig.packages?.strategy ?? 'all',
        ignore: options.ignore ?? baseConfig.packages?.ignore
      }
    }

    const buddy = new Buddy(config)
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

  } catch (error) {
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
 * Show help information
 */
export function helpCommand(): void {
  const help = `
🤖 Buddy - Automated Dependency Updates

USAGE:
  buddy <command> [options]

COMMANDS:
  scan      Scan for dependency updates
  update    Update dependencies and create PRs
  check     Check specific packages for updates
  help      Show this help message

OPTIONS:
  --verbose, -v         Enable verbose logging
  --config <path>       Path to config file
  --packages <names>    Comma-separated list of packages to check
  --pattern <pattern>   Glob pattern to match packages
  --strategy <type>     Update strategy: major|minor|patch|all
  --ignore <names>      Comma-separated list of packages to ignore
  --dry-run            Preview changes without making them

EXAMPLES:
  buddy scan
  buddy scan --verbose
  buddy scan --packages "react,typescript"
  buddy scan --pattern "@types/*"
  buddy scan --strategy minor
  buddy update --dry-run
  buddy update --strategy patch
  buddy check react typescript

CONFIGURATION:
  Create a buddy-bot.config.ts file in your project root:

  import type { BuddyBotConfig } from '@stacksjs/buddy'

  const config: BuddyBotConfig = {
    verbose: false,
    repository: {
      provider: 'github',
      owner: 'your-org',
      name: 'your-repo',
      token: process.env.GITHUB_TOKEN
    },
    packages: {
      strategy: 'all',
      ignore: ['package-to-ignore'],
      groups: [{
        name: 'TypeScript Types',
        patterns: ['@types/*'],
        strategy: 'minor'
      }]
    },
    pullRequest: {
      reviewers: ['maintainer'],
      labels: ['dependencies']
    }
  }

  export default config
`

  console.log(help)
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
    case 'help':
    case '--help':
    case '-h':
      helpCommand()
      break
    default:
      if (!command) {
        helpCommand()
      } else {
        console.error(`Unknown command: ${command}`)
        console.error('Run "buddy help" for usage information')
        process.exit(1)
      }
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
