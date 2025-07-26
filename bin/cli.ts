#!/usr/bin/env bun

import type { BuddyBotConfig } from '../src/types'
import process from 'node:process'
import { CAC } from 'cac'
import prompts from 'prompts'
import { version } from '../package.json'
import { Buddy } from '../src/buddy'
import { config } from '../src/config'
import { Logger } from '../src/utils/logger'

const cli = new CAC('buddy-bot')

cli.usage(`[command] [options]

🤖 Buddy Bot - Your companion dependency manager

DEPENDENCY MANAGEMENT:
  setup         🚀 Interactive setup for automated updates (recommended)
  scan          🔍 Scan for dependency updates
  dashboard     📊 Create or update dependency dashboard issue
  update        ⬆️  Update dependencies and create PRs
  rebase        🔄 Rebase/retry a pull request with latest updates
  check-rebase  🔍 Auto-detect and rebase PRs with checked rebase box
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

CONFIGURATION & SETUP:
  open-settings 🔧 Open GitHub repository and organization settings pages

Examples:
  buddy-bot setup                      # Interactive setup
  buddy-bot scan --verbose             # Scan for updates
  buddy-bot dashboard --pin            # Create pinned dashboard
  buddy-bot rebase 17                  # Rebase PR #17
  buddy-bot check-rebase               # Auto-rebase checked PRs
  buddy-bot info react                 # Get package info
  buddy-bot versions react --latest 5  # Show recent versions
  buddy-bot search "test framework"    # Search packages
  buddy-bot open-settings              # Open GitHub settings`)

// Define CLI options interface to match our core types
interface CLIOptions {
  verbose?: boolean
  config?: string
  packages?: string
  pattern?: string
  strategy?: 'major' | 'minor' | 'patch' | 'all'
  ignore?: string
  dryRun?: boolean
}

interface WorkflowPreset {
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
  custom?: {
    name: string
    schedule: string
    strategy: 'major' | 'minor' | 'patch' | 'all'
    autoMerge?: boolean
    autoMergeStrategy?: 'merge' | 'squash' | 'rebase'
  }[]
}

cli
  .command('setup', '🚀 Interactive setup for automated dependency updates (recommended)')
  .option('--verbose, -v', 'Enable verbose logging')
  .example('buddy-bot setup')
  .example('buddy-bot setup --verbose')
  .action(async (options: CLIOptions) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      console.log('🤖 Welcome to Buddy Bot Setup!')
      console.log('Let\'s configure automated dependency updates for your project.\n')

      const response = await prompts([
        {
          type: 'select',
          name: 'useCase',
          message: 'What would you like to use Buddy Bot for?',
          choices: [
            {
              title: 'Standard Project (Recommended)',
              description: 'Daily patch updates, weekly minor updates, monthly major updates',
              value: 'standard',
            },
            {
              title: 'High Frequency Updates',
              description: 'Check for updates 4 times per day (6AM, 12PM, 6PM, 12AM)',
              value: 'high-frequency',
            },
            {
              title: 'Security Focused',
              description: 'Frequent patch updates with security-first approach',
              value: 'security',
            },
            {
              title: 'Minimal Updates',
              description: 'Weekly patch updates, monthly minor/major updates',
              value: 'minimal',
            },
            {
              title: 'Docker Project',
              description: 'Optimized for containerized applications',
              value: 'docker',
            },
            {
              title: 'Monorepo',
              description: 'Multiple packages in a single repository',
              value: 'monorepo',
            },
            {
              title: 'Development/Testing',
              description: 'Manual trigger + every 5 minutes (for testing)',
              value: 'testing',
            },
            {
              title: 'Custom Configuration',
              description: 'Create your own update schedule',
              value: 'custom',
            },
          ],
        },
      ])

      if (!response.useCase) {
        console.log('Setup cancelled.')
        return
      }

      const preset = getWorkflowPreset(response.useCase)

      if (response.useCase === 'custom') {
        await setupCustomWorkflow(preset, logger)
      }
      else {
        console.log(`\n✨ Setting up ${preset.name}...`)
        console.log(`📋 ${preset.description}\n`)
      }

      await generateWorkflowsFromPreset(preset, logger)

      console.log('\n🎉 Setup complete! Your automated dependency update workflows have been generated.')
      console.log('\n💡 Next steps:')
      console.log('  1. Review the generated workflows in .github/workflows/')
      console.log('  2. Commit and push the workflow files to your repository')
      console.log('  3. Ensure GITHUB_TOKEN is available as a repository secret')
      console.log('  4. Configure buddy-bot.config.ts with your repository settings')
      console.log('\n🔗 Learn more: https://docs.github.com/en/actions')
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
  .example('buddy-bot scan')
  .example('buddy-bot scan --verbose')
  .example('buddy-bot scan --packages "react,typescript"')
  .example('buddy-bot scan --pattern "@types/*"')
  .example('buddy-bot scan --strategy minor')
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
  .option('--pin', 'Pin the dashboard issue')
  .option('--title <title>', 'Custom dashboard title')
  .option('--issue-number <number>', 'Update specific issue number')
  .example('buddy-bot dashboard')
  .example('buddy-bot dashboard --pin')
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
          pin: options.pin ?? config.dashboard?.pin,
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
  .example('buddy-bot update')
  .example('buddy-bot update --dry-run')
  .example('buddy-bot update --strategy patch')
  .example('buddy-bot update --verbose')
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

      // Get GitHub token from environment
      const token = process.env.GITHUB_TOKEN
      if (!token) {
        logger.error('❌ GITHUB_TOKEN environment variable required for PR operations')
        process.exit(1)
      }

      const { GitHubProvider } = await import('../src/git/github-provider')
      const gitProvider = new GitHubProvider(
        token,
        config.repository.owner,
        config.repository.name,
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

      // Find the matching update group
      const group = scanResult.groups.find(g =>
        g.updates.length === packageUpdates.length
        && g.updates.every(u => packageUpdates.some(pu => pu.name === u.name)),
      ) || scanResult.groups[0] // Fallback to first group

      if (!group) {
        logger.error('❌ Could not find matching update group')
        return
      }

      // Generate new package.json changes
      const packageJsonUpdates = await buddy.generatePackageJsonUpdates(group.updates)

      // Update the branch with new commits
      await gitProvider.commitChanges(pr.head, group.title, packageJsonUpdates)
      logger.info(`✅ Updated branch ${pr.head} with latest changes`)

      // Generate new PR content
      const { PullRequestGenerator } = await import('../src/pr/pr-generator')
      const prGenerator = new PullRequestGenerator()
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

  // Match table rows with package updates
  const tableRowRegex = /\|\s*\[([^\]]+)\][^|]*\|\s*\[`\^?([^`]+)`\s*->\s*`\^?([^`]+)`\]/g

  let match
  // eslint-disable-next-line no-cond-assign
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
  .command('check-rebase', 'Check all open buddy-bot PRs for rebase checkbox and auto-rebase if checked')
  .option('--verbose, -v', 'Enable verbose logging')
  .option('--dry-run', 'Check but don\'t actually rebase')
  .example('buddy-bot check-rebase')
  .example('buddy-bot check-rebase --verbose')
  .example('buddy-bot check-rebase --dry-run')
  .action(async (options: CLIOptions) => {
    const logger = options.verbose ? Logger.verbose() : Logger.quiet()

    try {
      logger.info('🔍 Checking for PRs with rebase checkbox enabled...')

      // Check if repository is configured
      if (!config.repository) {
        logger.error('❌ Repository configuration required for PR operations')
        logger.info('Configure repository.provider, repository.owner, repository.name in buddy-bot.config.ts')
        process.exit(1)
      }

      // Get GitHub token from environment
      const token = process.env.GITHUB_TOKEN
      if (!token) {
        logger.error('❌ GITHUB_TOKEN environment variable required for PR operations')
        process.exit(1)
      }

      const { GitHubProvider } = await import('../src/git/github-provider')
      const gitProvider = new GitHubProvider(
        token,
        config.repository.owner,
        config.repository.name,
      )

      // Get all open PRs
      const prs = await gitProvider.getPullRequests('open')
      const buddyPRs = prs.filter(pr =>
        pr.head.startsWith('buddy-bot/')
        || pr.author === 'github-actions[bot]'
        || pr.author.includes('buddy'),
      )

      if (buddyPRs.length === 0) {
        logger.info('📋 No buddy-bot PRs found')
        return
      }

      logger.info(`📋 Found ${buddyPRs.length} buddy-bot PR(s)`)

      let rebasedCount = 0

      for (const pr of buddyPRs) {
        // Check if rebase checkbox is checked
        const isRebaseChecked = checkRebaseCheckbox(pr.body)

        if (isRebaseChecked) {
          logger.info(`🔄 PR #${pr.number} has rebase checkbox checked: ${pr.title}`)

          if (options.dryRun) {
            logger.info('🔍 [DRY RUN] Would rebase this PR')
            rebasedCount++
          }
          else {
            logger.info(`🔄 Rebasing PR #${pr.number}...`)

            try {
              // Extract package updates from PR body
              const packageUpdates = await extractPackageUpdatesFromPRBody(pr.body)

              if (packageUpdates.length === 0) {
                logger.warn(`⚠️ Could not extract package updates from PR #${pr.number}, skipping`)
                continue
              }

              // Update the existing PR with latest updates (true rebase)
              const buddy = new Buddy({
                ...config,
                verbose: options.verbose ?? config.verbose,
              })

              const scanResult = await buddy.scanForUpdates()
              if (scanResult.updates.length === 0) {
                logger.info('✅ All dependencies are now up to date!')
                continue
              }

              // Find the matching update group
              const group = scanResult.groups.find(g =>
                g.updates.length === packageUpdates.length
                && g.updates.every(u => packageUpdates.some(pu => pu.name === u.name)),
              ) || scanResult.groups[0] // Fallback to first group

              if (!group) {
                logger.warn(`⚠️ Could not find matching update group for PR #${pr.number}, skipping`)
                continue
              }

              // Generate new package.json changes
              const packageJsonUpdates = await buddy.generatePackageJsonUpdates(group.updates)

              // Update the branch with new commits
              await gitProvider.commitChanges(pr.head, group.title, packageJsonUpdates)
              logger.info(`✅ Updated branch ${pr.head} with latest changes`)

              // Generate new PR content
              const { PullRequestGenerator } = await import('../src/pr/pr-generator')
              const prGenerator = new PullRequestGenerator()
              const newBody = await prGenerator.generateBody(group)

              // Update the PR with new title/body (and uncheck the rebase box)
              const updatedBody = newBody.replace(
                /- \[x\] <!-- rebase-check -->/g,
                '- [ ] <!-- rebase-check -->',
              )

              await gitProvider.updatePullRequest(pr.number, {
                title: group.title,
                body: updatedBody,
              })

              logger.success(`🔄 Successfully rebased PR #${pr.number} in place!`)
              rebasedCount++
            }
            catch (error) {
              logger.error(`❌ Failed to rebase PR #${pr.number}:`, error)
            }
          }
        }
        else {
          logger.info(`📋 PR #${pr.number}: No rebase requested`)
        }
      }

      if (rebasedCount > 0) {
        logger.success(`✅ ${options.dryRun ? 'Would rebase' : 'Successfully rebased'} ${rebasedCount} PR(s)`)
      }
      else {
        logger.info('✅ No PRs need rebasing')
      }
    }
    catch (error) {
      logger.error('Check-rebase failed:', error)
      process.exit(1)
    }
  })

// Helper function to check if rebase checkbox is checked
function checkRebaseCheckbox(body: string): boolean {
  // Look for the checked rebase checkbox pattern
  const checkedPattern = /- \[x\] <!-- rebase-check -->If you want to rebase\/retry this PR, check this box/i
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
      const registryClient = new RegistryClient(process.cwd(), logger)

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
      const registryClient = new RegistryClient(process.cwd(), logger)
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
      const registryClient = new RegistryClient(process.cwd(), logger)
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
      const registryClient = new RegistryClient(process.cwd(), logger)
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
      const registryClient = new RegistryClient(process.cwd(), logger)
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
      const registryClient = new RegistryClient(process.cwd(), logger)
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
            const registryClient = new RegistryClient(process.cwd(), logger)
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

// Helper functions for setup command
function getWorkflowPreset(useCase: string): WorkflowPreset {
  const presets: Record<string, WorkflowPreset> = {
    'standard': {
      name: 'Standard Project',
      description: 'Daily patch updates, weekly minor updates, monthly major updates',
      templates: {
        daily: true,
        weekly: true,
        monthly: true,
      },
    },
    'high-frequency': {
      name: 'High Frequency Updates',
      description: 'Check for updates 4 times per day (6AM, 12PM, 6PM, 12AM)',
      templates: {},
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
    },
    'docker': {
      name: 'Docker Project',
      description: 'Optimized for containerized applications',
      templates: {
        docker: true,
        weekly: true,
      },
    },
    'monorepo': {
      name: 'Monorepo',
      description: 'Multiple packages in a single repository',
      templates: {
        monorepo: true,
        daily: true,
      },
    },
    'testing': {
      name: 'Development/Testing',
      description: 'Manual trigger + every 5 minutes (for testing)',
      templates: {},
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
      custom: [],
    },
  }

  return presets[useCase] || presets.standard
}

async function setupCustomWorkflow(preset: WorkflowPreset, _logger: any): Promise<void> {
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

async function generateWorkflowsFromPreset(preset: WorkflowPreset, logger: any): Promise<void> {
  const { GitHubActionsTemplate } = await import('../src/templates/github-actions')
  const fs = await import('node:fs')
  const path = await import('node:path')

  // Create a config object from the preset
  const workflowConfig = {
    ...config,
    workflows: {
      enabled: true,
      outputDir: '.github/workflows',
      templates: preset.templates,
      custom: preset.custom || [],
    },
  }

  // Ensure output directory exists
  const outputDir = workflowConfig.workflows.outputDir
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  let generated = 0

  // Generate template workflows
  if (preset.templates.daily) {
    const workflows = GitHubActionsTemplate.generateScheduledWorkflows(workflowConfig)
    fs.writeFileSync(path.join(outputDir, 'buddy-bot-daily.yml'), workflows['dependency-updates-daily.yml'])
    logger.info('Generated daily update workflow')
    generated++
  }

  if (preset.templates.weekly) {
    const workflows = GitHubActionsTemplate.generateScheduledWorkflows(workflowConfig)
    fs.writeFileSync(path.join(outputDir, 'buddy-bot-weekly.yml'), workflows['dependency-updates-weekly.yml'])
    logger.info('Generated weekly update workflow')
    generated++
  }

  if (preset.templates.monthly) {
    const workflows = GitHubActionsTemplate.generateScheduledWorkflows(workflowConfig)
    fs.writeFileSync(path.join(outputDir, 'buddy-bot-monthly.yml'), workflows['dependency-updates-monthly.yml'])
    logger.info('Generated monthly update workflow')
    generated++
  }

  if (preset.templates.comprehensive) {
    const comprehensiveWorkflow = GitHubActionsTemplate.generateComprehensiveWorkflow(workflowConfig)
    fs.writeFileSync(path.join(outputDir, 'buddy-bot-comprehensive.yml'), comprehensiveWorkflow)
    logger.info('Generated comprehensive workflow')
    generated++
  }

  if (preset.templates.docker) {
    const dockerWorkflow = GitHubActionsTemplate.generateDockerWorkflow(workflowConfig)
    fs.writeFileSync(path.join(outputDir, 'buddy-bot-docker.yml'), dockerWorkflow)
    logger.info('Generated Docker workflow')
    generated++
  }

  if (preset.templates.monorepo) {
    const monorepoWorkflow = GitHubActionsTemplate.generateMonorepoWorkflow(workflowConfig)
    fs.writeFileSync(path.join(outputDir, 'buddy-bot-monorepo.yml'), monorepoWorkflow)
    logger.info('Generated monorepo workflow')
    generated++
  }

  // Generate custom workflows
  if (preset.custom && preset.custom.length > 0) {
    for (const customWorkflow of preset.custom) {
      let workflow: string

      // Use specialized testing workflow for testing preset
      if (customWorkflow.name === 'testing-updates') {
        workflow = GitHubActionsTemplate.generateTestingWorkflow(workflowConfig)
        fs.writeFileSync(path.join(outputDir, 'buddy-bot-testing.yml'), workflow)
        logger.info('Generated testing workflow with 5-minute schedule and manual triggers')
      }
      else {
        // Create auto-merge config object if enabled
        let autoMergeConfig: boolean | { enabled: boolean, strategy: 'merge' | 'squash' | 'rebase', conditions?: string[] } = customWorkflow.autoMerge || false

        if (customWorkflow.autoMerge && customWorkflow.autoMergeStrategy) {
          autoMergeConfig = {
            enabled: true,
            strategy: customWorkflow.autoMergeStrategy,
            conditions: customWorkflow.strategy === 'patch' ? ['patch-only'] : [],
          }
        }

        workflow = GitHubActionsTemplate.generateCustomWorkflow({
          name: customWorkflow.name,
          schedule: customWorkflow.schedule,
          strategy: customWorkflow.strategy,
          autoMerge: autoMergeConfig,
        }, workflowConfig)
        fs.writeFileSync(path.join(outputDir, `buddy-bot-${customWorkflow.name}.yml`), workflow)
        logger.info(`Generated custom workflow: ${customWorkflow.name}`)
      }

      generated++
    }
  }

  if (generated === 0) {
    logger.warn('No workflows were generated. Consider selecting at least one template or custom workflow.')
  }
  else {
    logger.success(`Generated ${generated} workflow${generated === 1 ? '' : 's'} in ${outputDir}`)
  }
}
