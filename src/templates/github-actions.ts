import type { BuddyBotConfig } from '../types'
import * as fs from 'node:fs'

export interface WorkflowConfig {
  name: string
  schedule: string
  strategy?: 'major' | 'minor' | 'patch' | 'all'
  timezone?: string
  autoMerge?: boolean | {
    enabled: boolean
    strategy: 'merge' | 'squash' | 'rebase'
    conditions?: string[]
  }
  reviewers?: string[]
  labels?: string[]
}

export class GitHubActionsTemplate {
  /**
   * Check if the project needs Composer support
   */
  private static needsComposerSupport(): boolean {
    return fs.existsSync('composer.json')
  }

  /**
   * Generate PHP and Composer setup steps for workflows
   */
  private static generateComposerSetupSteps(): string {
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

  /**
   * Generate standard setup steps for workflows
   */
  private static getStandardSetupSteps(): string {
    return `      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build buddy-bot
        run: bun run build`
  }

  /**
   * Generate GitHub Actions workflow
   */
  static generateWorkflow(config: WorkflowConfig): string {
    const workflow = `name: ${config.name}

on:
  schedule:
    - cron: '${config.schedule}'
  workflow_dispatch: # Allow manual triggering
    inputs:
      strategy:
        description: 'Update strategy'
        required: false
        default: '${config.strategy || 'all'}'
        type: choice
        options:
          - all
          - major
          - minor
          - patch
      dry_run:
        description: 'Dry run (preview only)'
        required: false
        default: false
        type: boolean

env:
  GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}

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
          token: \${{ secrets.GITHUB_TOKEN }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
\${GitHubActionsTemplate.generateComposerSetupSteps()}
      - name: Install dependencies
        run: bun install

      - name: Build buddy-bot
        run: bun run build

      - name: Run Buddy dependency updates
        run: |
          STRATEGY="\${{ github.event.inputs.strategy || '${config.strategy || 'all'}' }}"
          DRY_RUN="\${{ github.event.inputs.dry_run || 'false' }}"

          if [ "\$DRY_RUN" = "true" ]; then
            ./buddy update --strategy "\$STRATEGY" --dry-run --verbose
          else
            ./buddy update --strategy "\$STRATEGY" --verbose
          fi

      - name: Auto-merge updates
        if: \${{ ${config.autoMerge ? 'true' : 'false'} }}
        run: |
          echo "Auto-merge is enabled for this workflow"

          # Check if conditions are met for auto-merge
          STRATEGY="\${{ github.event.inputs.strategy || '${config.strategy || 'all'}' }}"
          AUTO_MERGE_STRATEGY="${typeof config.autoMerge === 'object' ? config.autoMerge.strategy || 'squash' : 'squash'}"

          echo "Update strategy: \$STRATEGY"
          echo "Auto-merge strategy: \$AUTO_MERGE_STRATEGY"

          # Enable auto-merge for created PRs
          # This will be implemented when the PR creation logic is fully integrated
          # For now, this step serves as a placeholder and configuration validation

          if [ "\$STRATEGY" = "patch" ]; then
            echo "✅ Patch updates are eligible for auto-merge"
          else
            echo "ℹ️ Only patch updates are auto-merged by default"
          fi
`

    return workflow
  }

  /**
   * Generate workflow for different scheduling strategies
   */
  static generateScheduledWorkflows(config?: BuddyBotConfig): Record<string, string> {
    const autoMergeConfig = config?.pullRequest?.autoMerge
    const reviewers = config?.pullRequest?.reviewers || []
    const labels = config?.pullRequest?.labels || []

    // Determine auto-merge settings based on configuration
    const dailyAutoMerge = autoMergeConfig?.enabled && autoMergeConfig.conditions?.includes('patch-only')
      ? autoMergeConfig
      : autoMergeConfig?.enabled ?? true // Default to enabled for daily patch updates

    const weeklyAutoMerge = autoMergeConfig?.enabled && !autoMergeConfig.conditions?.includes('patch-only')
      ? autoMergeConfig
      : false // Conservative for minor updates

    const monthlyAutoMerge = false // Never auto-merge major updates

    return {
      'dependency-updates-daily.yml': this.generateWorkflow({
        name: 'Daily Dependency Updates',
        schedule: config?.schedule?.cron || '0 2 * * *', // 2 AM daily
        strategy: 'patch',
        autoMerge: dailyAutoMerge,
        reviewers,
        labels,
      }),

      'dependency-updates-weekly.yml': this.generateWorkflow({
        name: 'Weekly Dependency Updates',
        schedule: '0 2 * * 1', // 2 AM Monday
        strategy: 'minor',
        autoMerge: weeklyAutoMerge,
        reviewers,
        labels,
      }),

      'dependency-updates-monthly.yml': this.generateWorkflow({
        name: 'Monthly Dependency Updates',
        schedule: '0 2 1 * *', // 2 AM first of month
        strategy: 'major',
        autoMerge: monthlyAutoMerge,
        reviewers,
        labels,
      }),
    }
  }

  /**
   * Generate comprehensive workflow with multiple strategies
   */
  static generateComprehensiveWorkflow(_config?: BuddyBotConfig): string {
    return `name: Buddy Dependency Updates

on:
  schedule:
    # Patch updates daily at 2 AM
    - cron: '0 2 * * *'
    # Minor updates twice weekly at 2 AM (Monday, Thursday)
    - cron: '0 2 * * 1,4'
    # Major updates monthly at 2 AM (first of month)
    - cron: '0 2 1 * *'

  workflow_dispatch:
    inputs:
      strategy:
        description: 'Update strategy'
        required: true
        default: 'all'
        type: choice
        options:
          - all
          - major
          - minor
          - patch
      dry_run:
        description: 'Dry run (preview only)'
        required: false
        default: false
        type: boolean
      packages:
        description: 'Specific packages (comma-separated)'
        required: false
        type: string

env:
  GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}

permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: read
  checks: read
  statuses: read

jobs:
  determine-strategy:
    runs-on: ubuntu-latest
    outputs:
      strategy: \${{ steps.strategy.outputs.strategy }}
      auto_merge: \${{ steps.strategy.outputs.auto_merge }}
    steps:
      - name: Determine update strategy
        id: strategy
        run: |
          if [ "\${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "strategy=\${{ github.event.inputs.strategy }}" >> \$GITHUB_OUTPUT
            echo "auto_merge=false" >> \$GITHUB_OUTPUT
          elif [ "\${{ github.event.schedule }}" = "0 2 * * *" ]; then
            echo "strategy=patch" >> \$GITHUB_OUTPUT
            echo "auto_merge=true" >> \$GITHUB_OUTPUT
          elif [ "\${{ github.event.schedule }}" = "0 2 * * 1,4" ]; then
            echo "strategy=minor" >> \$GITHUB_OUTPUT
            echo "auto_merge=false" >> \$GITHUB_OUTPUT
          else
            echo "strategy=major" >> \$GITHUB_OUTPUT
            echo "auto_merge=false" >> \$GITHUB_OUTPUT
          fi

  dependency-updates:
    runs-on: ubuntu-latest
    needs: determine-strategy

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
\${GitHubActionsTemplate.generateComposerSetupSteps()}
      - name: Install dependencies
        run: bun install

      - name: Build buddy-bot
        run: bun run build

      - name: Scan for updates
        run: |
          STRATEGY="\${{ needs.determine-strategy.outputs.strategy }}"
          PACKAGES="\${{ github.event.inputs.packages || '' }}"

          if [ "\$PACKAGES" != "" ]; then
            ./buddy scan --packages "\$PACKAGES" --verbose
          else
            ./buddy scan --strategy "\$STRATEGY" --verbose
          fi

      - name: Apply updates
        if: \${{ github.event.inputs.dry_run != 'true' }}
        run: |
          STRATEGY="\${{ needs.determine-strategy.outputs.strategy }}"
          PACKAGES="\${{ github.event.inputs.packages || '' }}"

          if [ "\$PACKAGES" != "" ]; then
            ./buddy update --packages "\$PACKAGES" --verbose
          else
            ./buddy update --strategy "\$STRATEGY" --verbose
          fi

      - name: Dry run mode
        if: \${{ github.event.inputs.dry_run == 'true' }}
        run: |
          echo "🔍 Dry run mode - showing what would be updated"
          STRATEGY="\${{ needs.determine-strategy.outputs.strategy }}"
          PACKAGES="\${{ github.event.inputs.packages || '' }}"

          if [ "\$PACKAGES" != "" ]; then
            ./buddy update --packages "\$PACKAGES" --dry-run --verbose
          else
            ./buddy update --strategy "\$STRATEGY" --dry-run --verbose
          fi

      - name: Auto-merge eligible updates
        if: \${{ needs.determine-strategy.outputs.auto_merge == 'true' && github.event.inputs.dry_run != 'true' }}
        run: |
          echo "🤖 Auto-merge enabled for patch updates"
          echo "This feature will be implemented in future versions"
`
  }

  /**
   * Generate Docker-based workflow for complex setups
   */
  static generateDockerWorkflow(_config?: BuddyBotConfig): string {
    return `name: Buddy Dependencies (Docker)

on:
  schedule:
    - cron: '0 2 * * 1' # Weekly on Monday
  workflow_dispatch:

jobs:
  dependency-updates:
    runs-on: ubuntu-latest
    container:
      image: oven/bun:latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install dependencies
        run: bun install

      - name: Run Buddy updates
        run: bunx buddy-bot update --verbose
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`
  }

  /**
   * Generate workflow for monorepos
   */
  static generateMonorepoWorkflow(_config?: BuddyBotConfig): string {
    return `name: Buddy Monorepo Updates

on:
  schedule:
    - cron: '0 2 * * 1'
  workflow_dispatch:
    inputs:
      workspace:
        description: 'Workspace to update'
        required: false
        type: string

jobs:
  find-workspaces:
    runs-on: ubuntu-latest
    outputs:
      workspaces: \${{ steps.workspaces.outputs.workspaces }}
    steps:
      - uses: actions/checkout@v4
      - name: Find workspaces
        id: workspaces
        run: |
          if [ "\${{ github.event.inputs.workspace }}" != "" ]; then
            echo "workspaces=[\"\${{ github.event.inputs.workspace }}\"]" >> \$GITHUB_OUTPUT
          else
            # Find all package.json files
            WORKSPACES=\$(find . -name "package.json" -not -path "./node_modules/*" | sed 's|/package.json||' | sed 's|^./||' | jq -R . | jq -s .)
            echo "workspaces=\$WORKSPACES" >> \$GITHUB_OUTPUT
          fi

  update-workspace:
    needs: find-workspaces
    runs-on: ubuntu-latest
    strategy:
      matrix:
        workspace: \${{ fromJson(needs.find-workspaces.outputs.workspaces) }}

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Update workspace dependencies
        run: |
          cd \${{ matrix.workspace }}
          bunx buddy-bot update --verbose
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`
  }

  /**
   * Generate testing workflow with enhanced manual controls
   */
  static generateTestingWorkflow(_config?: BuddyBotConfig): string {
    return `name: Buddy Update

on:
  schedule:
    - cron: '*/5 * * * *' # Every 5 minutes for testing
  workflow_dispatch: # Manual triggering for development
    inputs:
      strategy:
        description: 'Update strategy'
        required: false
        default: 'patch'
        type: choice
        options:
          - all
          - major
          - minor
          - patch
      dry_run:
        description: 'Dry run (preview only)'
        required: false
        default: true
        type: boolean
      packages:
        description: 'Specific packages (comma-separated)'
        required: false
        type: string
      verbose:
        description: 'Enable verbose logging'
        required: false
        default: true
        type: boolean

env:
  GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}

permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: read
  checks: read
  statuses: read

jobs:
  dependency-update:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
\${GitHubActionsTemplate.generateComposerSetupSteps()}
      - name: Install dependencies
        run: bun install

      - name: Build buddy-bot
        run: bun run build

      - name: Display test configuration
        run: |
          echo "🧪 **Buddy Bot Testing Mode**"
          echo "Strategy: \${{ github.event.inputs.strategy || 'patch' }}"
          echo "Dry Run: \${{ github.event.inputs.dry_run || 'true' }}"
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

          if [ "\$PACKAGES" != "" ]; then
            if [ "\$VERBOSE" = "true" ]; then
              ./buddy scan --packages "\$PACKAGES" --verbose
            else
              ./buddy scan --packages "\$PACKAGES"
            fi
          else
            if [ "\$VERBOSE" = "true" ]; then
              ./buddy scan --strategy "\$STRATEGY" --verbose
            else
              ./buddy scan --strategy "\$STRATEGY"
            fi
          fi

      - name: Run Buddy dependency updates
        if: \${{ github.event.inputs.dry_run != 'true' }}
        run: |
          STRATEGY="\${{ github.event.inputs.strategy || 'patch' }}"
          PACKAGES="\${{ github.event.inputs.packages }}"
          VERBOSE="\${{ github.event.inputs.verbose || 'true' }}"

          echo "🚀 Running dependency updates..."

          if [ "\$PACKAGES" != "" ]; then
            if [ "\$VERBOSE" = "true" ]; then
              ./buddy update --packages "\$PACKAGES" --verbose
            else
              ./buddy update --packages "\$PACKAGES"
            fi
          else
            if [ "\$VERBOSE" = "true" ]; then
              ./buddy update --strategy "\$STRATEGY" --verbose
            else
              ./buddy update --strategy "\$STRATEGY"
            fi
          fi

      - name: Dry run notification
        if: \${{ github.event.inputs.dry_run == 'true' }}
        run: |
          echo "ℹ️ **Dry Run Mode** - No changes were made"
          echo "To apply updates, run this workflow again with 'Dry run' set to false"

      - name: Create test summary
        if: always()
        run: |
          echo "## 🧪 Buddy Bot Testing Summary" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "- **Strategy**: \${{ github.event.inputs.strategy || 'patch' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Triggered by**: \${{ github.event_name }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Dry run**: \${{ github.event.inputs.dry_run || 'true' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Packages**: \${{ github.event.inputs.packages || 'all' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Verbose**: \${{ github.event.inputs.verbose || 'true' }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Time**: \$(date)" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY

          if [ "\${{ github.event_name }}" = "schedule" ]; then
            echo "⏰ **Scheduled Run**: This was triggered automatically every 5 minutes" >> \$GITHUB_STEP_SUMMARY
            echo "💡 **Tip**: Use 'Actions' tab to manually trigger with custom settings" >> \$GITHUB_STEP_SUMMARY
          else
            echo "🖱️ **Manual Trigger**: This was triggered manually from the Actions tab" >> \$GITHUB_STEP_SUMMARY
            echo "⏰ **Auto-Schedule**: This workflow also runs every 5 minutes for testing" >> \$GITHUB_STEP_SUMMARY
          fi

          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "📊 View detailed logs above for scan and update results." >> \$GITHUB_STEP_SUMMARY
`
  }

  /**
   * Generate custom workflow from configuration
   */
  static generateCustomWorkflow(
    customConfig: {
      name: string
      schedule: string
      strategy?: 'major' | 'minor' | 'patch' | 'all'
      autoMerge?: boolean | { enabled: boolean, strategy: 'merge' | 'squash' | 'rebase', conditions?: string[] }
      reviewers?: string[]
      labels?: string[]
    },
    config?: BuddyBotConfig,
  ): string {
    // Determine auto-merge configuration
    let autoMergeConfig: boolean | { enabled: boolean, strategy: 'merge' | 'squash' | 'rebase', conditions?: string[] } = false

    if (customConfig.autoMerge !== undefined) {
      // Use explicit custom config
      autoMergeConfig = customConfig.autoMerge
    }
    else if (config?.pullRequest?.autoMerge) {
      // Use global auto-merge config, respecting conditions
      const autoMerge = config.pullRequest.autoMerge
      if (autoMerge.enabled) {
        // Check if strategy matches conditions
        if (autoMerge.conditions?.includes('patch-only') && customConfig.strategy === 'patch') {
          autoMergeConfig = autoMerge
        }
        else if (!autoMerge.conditions?.includes('patch-only')) {
          autoMergeConfig = autoMerge
        }
      }
    }

    return this.generateWorkflow({
      name: customConfig.name,
      schedule: customConfig.schedule,
      strategy: customConfig.strategy || 'all',
      autoMerge: autoMergeConfig,
      reviewers: customConfig.reviewers || config?.pullRequest?.reviewers || [],
      labels: customConfig.labels || config?.pullRequest?.labels || [],
    })
  }
}
