import type { BuddyBotConfig } from '../types'

export interface WorkflowConfig {
  name: string
  schedule: string
  strategy?: 'major' | 'minor' | 'patch' | 'all'
  timezone?: string
  autoMerge?: boolean
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

      - name: Auto-merge patch updates
        if: \${{ ${config.autoMerge ? 'true' : 'false'} && github.event.inputs.strategy == 'patch' }}
        run: |
          echo "Auto-merging patch updates..."
          # Add auto-merge logic here when needed
`

    return workflow
  }

  /**
   * Generate workflow for different scheduling strategies
   */
  static generateScheduledWorkflows(config?: BuddyBotConfig): Record<string, string> {
    const defaultAutoMerge = config?.pullRequest?.autoMerge?.enabled ?? false
    const reviewers = config?.pullRequest?.reviewers || []
    const labels = config?.pullRequest?.labels || []

    return {
      'dependency-updates-daily.yml': this.generateWorkflow({
        name: 'Daily Dependency Updates',
        schedule: config?.schedule?.cron || '0 2 * * *', // 2 AM daily
        strategy: 'patch',
        autoMerge: true,
        reviewers,
        labels,
      }),

      'dependency-updates-weekly.yml': this.generateWorkflow({
        name: 'Weekly Dependency Updates',
        schedule: '0 2 * * 1', // 2 AM Monday
        strategy: 'minor',
        autoMerge: defaultAutoMerge,
        reviewers,
        labels,
      }),

      'dependency-updates-monthly.yml': this.generateWorkflow({
        name: 'Monthly Dependency Updates',
        schedule: '0 2 1 * *', // 2 AM first of month
        strategy: 'major',
        autoMerge: false,
        reviewers,
        labels,
      }),
    }
  }

  /**
   * Generate comprehensive workflow with multiple strategies
   */
  static generateComprehensiveWorkflow(config?: BuddyBotConfig): string {
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
  static generateDockerWorkflow(config?: BuddyBotConfig): string {
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
  static generateMonorepoWorkflow(config?: BuddyBotConfig): string {
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
   * Generate custom workflow from configuration
   */
  static generateCustomWorkflow(
    customConfig: {
      name: string
      schedule: string
      strategy?: 'major' | 'minor' | 'patch' | 'all'
      autoMerge?: boolean
      reviewers?: string[]
      labels?: string[]
    },
    config?: BuddyBotConfig
  ): string {
    return this.generateWorkflow({
      name: customConfig.name,
      schedule: customConfig.schedule,
      strategy: customConfig.strategy || 'all',
      autoMerge: customConfig.autoMerge ?? false,
      reviewers: customConfig.reviewers || config?.pullRequest?.reviewers || [],
      labels: customConfig.labels || config?.pullRequest?.labels || [],
    })
  }
}
