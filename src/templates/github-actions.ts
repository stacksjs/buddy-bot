import type { BuddyBotConfig } from '../types'

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
   * Generate a complete GitHub Actions workflow for dependency updates
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

jobs:
  dependency-updates:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Run Buddy dependency updates
        run: |
          STRATEGY="\${{ github.event.inputs.strategy || '${config.strategy || 'all'}' }}"
          DRY_RUN="\${{ github.event.inputs.dry_run || 'false' }}"

          if [ "\$DRY_RUN" = "true" ]; then
            bunx buddy-bot update --strategy "\$STRATEGY" --dry-run --verbose
          else
            bunx buddy-bot update --strategy "\$STRATEGY" --verbose
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
    needs: determine-strategy
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Cache dependencies
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: \${{ runner.os }}-bun-\${{ hashFiles('**/bun.lockb') }}
          restore-keys: |
            \${{ runner.os }}-bun-

      - name: Install dependencies
        run: bun install

      - name: Configure Git
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"

      - name: Run Buddy dependency scan
        id: scan
        run: |
          STRATEGY="\${{ needs.determine-strategy.outputs.strategy }}"

          if [ "\${{ github.event.inputs.packages }}" != "" ]; then
            echo "Checking specific packages: \${{ github.event.inputs.packages }}"
            bunx buddy-bot scan --packages "\${{ github.event.inputs.packages }}" --verbose
          else
            echo "Running \$STRATEGY dependency scan..."
            bunx buddy-bot scan --strategy "\$STRATEGY" --verbose
          fi

      - name: Update dependencies
        if: \${{ !github.event.inputs.dry_run }}
        run: |
          STRATEGY="\${{ needs.determine-strategy.outputs.strategy }}"

          if [ "\${{ github.event.inputs.packages }}" != "" ]; then
            bunx buddy-bot update --packages "\${{ github.event.inputs.packages }}" --verbose
          else
            bunx buddy-bot update --strategy "\$STRATEGY" --verbose
          fi

      - name: Auto-merge safe updates
        if: \${{ needs.determine-strategy.outputs.auto_merge == 'true' && !github.event.inputs.dry_run }}
        run: |
          echo "Auto-merging patch updates..."
          # Auto-merge logic for patch updates
          # This would be implemented when Git providers are fully integrated

      - name: Create summary
        if: always()
        run: |
          echo "## 🤖 Buddy Dependency Update Summary" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "- **Strategy**: \${{ needs.determine-strategy.outputs.strategy }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Triggered by**: \${{ github.event_name }}" >> \$GITHUB_STEP_SUMMARY
          echo "- **Auto-merge**: \${{ needs.determine-strategy.outputs.auto_merge }}" >> \$GITHUB_STEP_SUMMARY

          if [ "\${{ github.event.inputs.dry_run }}" = "true" ]; then
            echo "- **Mode**: Dry run (preview only)" >> \$GITHUB_STEP_SUMMARY
          fi

          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "View the [workflow run](\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}) for detailed logs." >> \$GITHUB_STEP_SUMMARY

  notify-on-failure:
    needs: [determine-strategy, dependency-updates]
    runs-on: ubuntu-latest
    if: failure()
    steps:
      - name: Create issue on failure
        uses: actions/github-script@v7
        with:
          script: |
            const title = 'Buddy Dependency Update Failed';
            const body = \`## 🚨 Dependency Update Failure

            The automated dependency update process failed.

            **Details:**
            - Strategy: \${{ needs.determine-strategy.outputs.strategy }}
            - Workflow: [\${{ github.run_id }}](\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }})
            - Triggered by: \${{ github.event_name }}

            Please review the workflow logs and resolve any issues.
            \`;

            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: title,
              body: body,
              labels: ['bug', 'dependencies', 'automation']
            });
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
  static generateTestingWorkflow(config?: BuddyBotConfig): string {
    return `name: Buddy Testing Updates

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

jobs:
  test-dependency-updates:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

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

      - name: Run Buddy dependency updates
        if: \${{ github.event.inputs.dry_run != 'true' }}
        run: |
          STRATEGY="\${{ github.event.inputs.strategy || 'patch' }}"
          PACKAGES="\${{ github.event.inputs.packages }}"
          VERBOSE="\${{ github.event.inputs.verbose || 'true' }}"

          echo "🚀 Running dependency updates..."

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
