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
  custom?: {
    name: string
    schedule: string
    strategy: 'major' | 'minor' | 'patch' | 'all'
    autoMerge?: boolean
    autoMergeStrategy?: 'merge' | 'squash' | 'rebase'
  }[]
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
  console.log(`\n🔑 To create a Personal Access Token (PAT):`)
  console.log(`1. Go to https://github.com/settings/tokens`)
  console.log(`2. Click "Generate new token"`)
  console.log(`3. Give it a name (e.g., "buddy-bot-token")`)
  console.log(`4. Select scopes:`)
  console.log(`   - ` + 'repo' + ` (Full control of private repositories)`)
  console.log(`   - ` + 'workflow' + ` (Read and write permissions for GitHub Actions)`)
  console.log(`5. Click "Generate token"`)
  console.log(`6. Copy the token and set it as a repository secret:`)
  console.log(`   - Go to your repository settings (https://github.com/${repoInfo.owner}/${repoInfo.name}/settings/secrets/actions)`)
  console.log(`   - Click "New repository secret"`)
  console.log(`   - Name: ` + 'BUDDY_BOT_TOKEN' + `, Value: your_generated_token`)
  console.log(`   - Click "Add secret"`)
  console.log(`7. After adding the secret, Buddy Bot will use it for workflow updates.\n`)
}

export async function confirmTokenSetup(): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'useCustomToken',
    message: 'Do you want to use a custom GitHub Personal Access Token (PAT) for workflow updates?',
    initial: false,
  })
  return response.useCustomToken
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
  const configContent = JSON.stringify({
    repository: {
      owner: repoInfo.owner,
      name: repoInfo.name,
      provider: 'github' as const,
      token: hasCustomToken ? undefined : process.env.GITHUB_TOKEN,
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
  }, null, 2)

  const configPath = 'buddy-bot.config.json'
  fs.writeFileSync(configPath, configContent)
  console.log(`✅ Created ${configPath} with your repository settings.`)
  console.log(`💡 You can edit this file to customize Buddy Bot's behavior.\n`)
}

export function generateDashboardWorkflow(hasCustomToken: boolean): string {
  const tokenEnv = hasCustomToken
    // eslint-disable-next-line no-template-curly-in-string
    ? '${{ secrets.BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN }}'
    // eslint-disable-next-line no-template-curly-in-string
    : '${{ secrets.GITHUB_TOKEN }}'

  return `name: Buddy Dashboard Management

on:
  schedule:
    - cron: '0 9 * * 1,3,5' # Monday, Wednesday, Friday at 9 AM UTC
  workflow_dispatch: # Manual triggering
    inputs:
      pin:
        description: Pin the dashboard issue
        required: false
        default: true
        type: boolean
      title:
        description: Custom dashboard title
        required: false
        type: string
      issue_number:
        description: Specific issue number to update
        required: false
        type: string
      verbose:
        description: Enable verbose logging
        required: false
        default: true
        type: boolean
      dry_run:
        description: Dry run (preview only)
        required: false
        default: false
        type: boolean

env:
  GITHUB_TOKEN: ${tokenEnv}

permissions:
  contents: read
  pull-requests: read
  issues: write
  actions: read
  checks: read
  statuses: read

jobs:
  update-dashboard:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${tokenEnv}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build buddy-bot
        run: bun run build

      - name: Update Dependency Dashboard
        run: |
          PIN="\${{ github.event.inputs.pin || 'true' }}"
          TITLE="\${{ github.event.inputs.title }}"
          ISSUE_NUMBER="\${{ github.event.inputs.issue_number }}"
          VERBOSE="\${{ github.event.inputs.verbose || 'true' }}"
          DRY_RUN="\${{ github.event.inputs.dry_run || 'false' }}"

          echo "📊 Updating dependency dashboard..."
          set -e

          COMMAND="bun buddy dashboard"

          if [ "$PIN" = "true" ]; then
            COMMAND="$COMMAND --pin"
          fi

          if [ "$TITLE" != "" ]; then
            COMMAND="$COMMAND --title \\"$TITLE\\""
          fi

          if [ "$ISSUE_NUMBER" != "" ]; then
            COMMAND="$COMMAND --issue-number \\"$ISSUE_NUMBER\\""
          fi

          if [ "$VERBOSE" = "true" ]; then
            COMMAND="$COMMAND --verbose"
          fi

          if [ "$DRY_RUN" = "true" ]; then
            echo "📋 DRY RUN MODE - Command preview:"
            echo "$COMMAND"
            bun buddy scan --verbose
          else
            echo "🚀 Executing: $COMMAND"
            eval "$COMMAND"
          fi

        env:
          GITHUB_TOKEN: ${tokenEnv}
`
}

export function generateUpdateCheckWorkflow(hasCustomToken: boolean): string {
  const tokenEnv = hasCustomToken
    // eslint-disable-next-line no-template-curly-in-string
    ? '${{ secrets.BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN }}'
    // eslint-disable-next-line no-template-curly-in-string
    : '${{ secrets.GITHUB_TOKEN }}'

  return `name: Buddy Update Check

on:
  schedule:
    - cron: '*/15 * * * *' # Check every 15 minutes
  workflow_dispatch: # Manual trigger
    inputs:
      dry_run:
        description: Dry run (preview only)
        required: false
        default: false
        type: boolean

env:
  GITHUB_TOKEN: ${tokenEnv}

permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: write

jobs:
  update-check:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${tokenEnv}
          fetch-depth: 0
          persist-credentials: true

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build buddy-bot
        run: bun run build

      - name: Configure Git
        run: |
          git config --global user.name "buddy-bot[bot]"
          git config --global user.email "buddy-bot[bot]@users.noreply.github.com"

      - name: Check for rebase requests
        run: |
          echo "🔍 Checking for PRs with rebase checkbox enabled..."

          if [ "\${{ github.event.inputs.dry_run }}" = "true" ]; then
            echo "📋 Running in DRY RUN mode..."
            bun buddy update-check --dry-run --verbose
          else
            echo "🔄 Running in LIVE mode..."
            bun buddy update-check --verbose
          fi

        env:
          GITHUB_TOKEN: ${tokenEnv}
`
}

export function generateUpdateWorkflow(preset: WorkflowPreset, hasCustomToken: boolean): string {
  const tokenEnv = hasCustomToken
    // eslint-disable-next-line no-template-curly-in-string
    ? '${{ secrets.BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN }}'
    // eslint-disable-next-line no-template-curly-in-string
    : '${{ secrets.GITHUB_TOKEN }}'

  // Determine schedule based on preset
  let schedule = '0 9 * * 1' // Default: Monday at 9 AM
  let description = 'Dependency Updates'

  switch (preset.name) {
    case 'Standard Project':
      schedule = '0 9 * * 1,3,5' // Mon, Wed, Fri
      description = 'Standard Dependency Updates'
      break
    case 'High Frequency Updates':
      schedule = '0 */6 * * *' // Every 6 hours
      description = 'High Frequency Updates'
      break
    case 'Security Focused':
      schedule = '0 */4 * * *' // Every 4 hours
      description = 'Security-Focused Updates'
      break
    case 'Minimal Updates':
      schedule = '0 9 * * 1' // Monday only
      description = 'Minimal Updates'
      break
    case 'Development/Testing':
      schedule = '*/15 * * * *' // Every 15 minutes
      description = 'Testing Updates'
      break
  }

  return `name: ${description}

on:
  schedule:
    - cron: '${schedule}'
  workflow_dispatch:
    inputs:
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
      dry_run:
        description: Dry run (preview only)
        required: false
        default: false
        type: boolean
      packages:
        description: Specific packages (comma-separated)
        required: false
        type: string
      verbose:
        description: Enable verbose logging
        required: false
        default: true
        type: boolean

env:
  GITHUB_TOKEN: ${tokenEnv}

permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: read
  checks: read
  statuses: read

jobs:
  dependency-updates:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${tokenEnv}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build buddy-bot
        run: bun run build

      - name: Run dependency updates
        run: |
          STRATEGY="\${{ github.event.inputs.strategy || 'patch' }}"
          PACKAGES="\${{ github.event.inputs.packages }}"
          VERBOSE="\${{ github.event.inputs.verbose || 'true' }}"
          DRY_RUN="\${{ github.event.inputs.dry_run || 'false' }}"

          echo "🔍 Scanning for dependency updates..."
          set -e

          if [ "$PACKAGES" != "" ]; then
            if [ "$VERBOSE" = "true" ]; then
              bun buddy scan --packages "$PACKAGES" --verbose
            else
              bun buddy scan --packages "$PACKAGES"
            fi
          else
            if [ "$VERBOSE" = "true" ]; then
              bun buddy scan --strategy "$STRATEGY" --verbose
            else
              bun buddy scan --strategy "$STRATEGY"
            fi
          fi

          if [ "$DRY_RUN" != "true" ]; then
            echo "🚀 Running dependency updates..."
            if [ "$PACKAGES" != "" ]; then
              if [ "$VERBOSE" = "true" ]; then
                bun buddy update --packages "$PACKAGES" --verbose
              else
                bun buddy update --packages "$PACKAGES"
              fi
            else
              if [ "$VERBOSE" = "true" ]; then
                bun buddy update --strategy "$STRATEGY" --verbose
              else
                bun buddy update --strategy "$STRATEGY"
            fi
          else
            echo "📋 DRY RUN MODE - No changes made"
          fi

        env:
          GITHUB_TOKEN: ${tokenEnv}
`
}

export async function generateCoreWorkflows(preset: WorkflowPreset, repoInfo: RepositoryInfo, hasCustomToken: boolean, logger: Logger): Promise<void> {
  // Ensure output directory exists
  const outputDir = '.github/workflows'
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  let generated = 0

  // Generate core workflows based on user's project templates

  // 1. Dashboard workflow
  const dashboardWorkflow = generateDashboardWorkflow(hasCustomToken)
  fs.writeFileSync(path.join(outputDir, 'buddy-dashboard.yml'), dashboardWorkflow)
  logger.info('Generated dependency dashboard workflow')
  generated++

  // 2. Update check workflow
  const updateCheckWorkflow = generateUpdateCheckWorkflow(hasCustomToken)
  fs.writeFileSync(path.join(outputDir, 'buddy-update-check.yml'), updateCheckWorkflow)
  logger.info('Generated update check workflow (for PR rebase automation)')
  generated++

  // 3. Update workflow based on preset
  const updateWorkflow = generateUpdateWorkflow(preset, hasCustomToken)
  fs.writeFileSync(path.join(outputDir, 'buddy-update.yml'), updateWorkflow)
  logger.info(`Generated dependency update workflow (${preset.name})`)
  generated++

  if (generated === 0) {
    logger.warn('No workflows were generated.')
  }
  else {
    logger.success(`Generated ${generated} workflow${generated === 1 ? '' : 's'} in ${outputDir}`)
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
  console.log('✅ Generated 3 core workflows in .github/workflows/:')
  console.log(`   - buddy-dashboard.yml (Dependency Dashboard Management)`)
  console.log(`   - buddy-update-check.yml (Auto-rebase PR checker)`)
  console.log(`   - buddy-update.yml (Scheduled dependency updates)`)
  console.log(`📁 Configuration file: buddy-bot.config.json`)

  console.log(`\n🚀 Next Steps:`)
  console.log(`1. Review and commit the generated workflow files`)
  console.log(`   git add .github/workflows/ buddy-bot.config.json`)
  console.log(`   git commit -m "Add Buddy Bot dependency management workflows"`)
  console.log(`   git push`)

  if (hasCustomToken) {
    console.log(`\n2. 🔑 Set up your Personal Access Token:`)
    console.log(`   - Go to: https://github.com/${repoInfo.owner}/${repoInfo.name}/settings/secrets/actions`)
    console.log(`   - Click "New repository secret"`)
    console.log(`   - Name: BUDDY_BOT_TOKEN`)
    console.log(`   - Value: your_personal_access_token`)
    console.log(`   - Click "Add secret"`)
  }
  else {
    console.log(`\n2. ✅ Using default GITHUB_TOKEN (limited functionality)`)
    console.log(`   - Workflow file updates won't work`)
    console.log(`   - Consider upgrading to a Personal Access Token later`)
  }

  console.log(`\n3. 🔧 Configure repository permissions:`)
  console.log(`   - Go to: https://github.com/${repoInfo.owner}/${repoInfo.name}/settings/actions`)
  console.log(`   - Under "Workflow permissions":`)
  console.log(`     ✅ Select "Read and write permissions"`)
  console.log(`     ✅ Check "Allow GitHub Actions to create and approve pull requests"`)
  console.log(`   - Click "Save"`)

  console.log(`\n💡 Your workflows will now run automatically!`)
  console.log(`🔗 Learn more: https://docs.github.com/en/actions`)
}
