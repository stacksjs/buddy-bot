/** How often the generated pipeline runs. */
export interface PipelineSchedule {
  /** Cron for dependency updates */
  update: string
  /** Cron for the dashboard refresh */
  dashboard: string
}

/** Defaults matching the GitHub Actions "standard" preset. */
export const DEFAULT_SCHEDULE: PipelineSchedule = {
  update: '0 */2 * * *',
  dashboard: '0 9 * * 1,3,5',
}

/**
 * Generate a `.gitlab-ci.yml` fragment that runs Buddy Bot.
 *
 * GitLab has no equivalent of a workflow's `schedule:` block — pipeline
 * schedules are configured in the project UI and surface to the job as
 * `$CI_PIPELINE_SOURCE == "schedule"` plus a variable the schedule sets. The
 * generated file therefore branches on a `BUDDY_JOB` variable, and the
 * instructions say which schedules to create. Pretending otherwise would
 * produce a file that never runs and gives no clue why.
 *
 * @param options - Whether to include the review job
 * @returns YAML to write to `.gitlab-ci.yml`
 * @example
 * ```ts
 * await Bun.write('.gitlab-ci.yml', generateGitLabPipeline({ review: true }))
 * ```
 */
export function generateGitLabPipeline(options: { review?: boolean } = {}): string {
  const lines = [
    '# Buddy Bot — dependency updates for GitLab',
    '#',
    '# GitLab schedules live in the project UI, not in this file:',
    '#   Settings → CI/CD → Pipeline schedules → New schedule',
    '#',
    '# Create two schedules, each with a variable:',
    `#   BUDDY_JOB=update      cron: ${DEFAULT_SCHEDULE.update}`,
    `#   BUDDY_JOB=dashboard   cron: ${DEFAULT_SCHEDULE.dashboard}`,
    '#',
    '# Set GITLAB_TOKEN as a masked CI/CD variable with `api` scope. The',
    '# ambient CI_JOB_TOKEN cannot open merge requests.',
    '',
    '.buddy-bot:',
    '  image: oven/bun:latest',
    '  before_script:',
    '    - bun install --frozen-lockfile',
    '',
    'buddy:update:',
    '  extends: .buddy-bot',
    '  rules:',
    '    - if: $CI_PIPELINE_SOURCE == "schedule" && $BUDDY_JOB == "update"',
    '    - if: $CI_PIPELINE_SOURCE == "web" && $BUDDY_JOB == "update"',
    '  script:',
    '    - bunx buddy-bot update --verbose',
    '',
    'buddy:dashboard:',
    '  extends: .buddy-bot',
    '  rules:',
    '    - if: $CI_PIPELINE_SOURCE == "schedule" && $BUDDY_JOB == "dashboard"',
    '    - if: $CI_PIPELINE_SOURCE == "web" && $BUDDY_JOB == "dashboard"',
    '  script:',
    '    - bunx buddy-bot dashboard --pin',
    '',
    'buddy:check:',
    '  extends: .buddy-bot',
    '  rules:',
    '    # Runs on merge request events so a ticked rebase box is picked up',
    '    # without waiting for the next schedule.',
    '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
    '  script:',
    '    - bunx buddy-bot update-check --verbose',
  ]

  if (options.review) {
    lines.push(
      '',
      'buddy:review:',
      '  extends: .buddy-bot',
      '  rules:',
      '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
      '  script:',
      '    - bunx buddy-bot review $CI_MERGE_REQUEST_IID --verbose',
    )
  }

  return `${lines.join('\n')}\n`
}

/**
 * Generate a `bitbucket-pipelines.yml` that runs Buddy Bot.
 *
 * Bitbucket's scheduled pipelines are also configured in the UI, and they can
 * only run a *branch* pipeline — a schedule cannot target a custom pipeline
 * directly. The custom pipelines below are what a schedule points at, and the
 * instructions say so rather than leaving a file that silently never fires.
 *
 * @param options - Whether to include the review pipeline
 * @returns YAML to write to `bitbucket-pipelines.yml`
 */
export function generateBitbucketPipeline(options: { review?: boolean } = {}): string {
  const lines = [
    '# Buddy Bot — dependency updates for Bitbucket Cloud',
    '#',
    '# Bitbucket schedules live in the UI, not in this file:',
    '#   Repository settings → Pipelines → Schedules',
    '#',
    '# Point a schedule at each custom pipeline below.',
    '#',
    '# Set BITBUCKET_TOKEN as a secured repository variable. It needs',
    '# pull-request write and repository write.',
    '',
    'image: oven/bun:latest',
    '',
    'definitions:',
    '  steps:',
    '    - step: &install',
    '        name: Install',
    '        caches:',
    '          - node',
    '        script:',
    '          - bun install --frozen-lockfile',
    '',
    'pipelines:',
    '  custom:',
    '    buddy-update:',
    '      - step:',
    '          name: Dependency updates',
    '          script:',
    '            - bun install --frozen-lockfile',
    '            - bunx buddy-bot update --verbose',
    '',
    '    buddy-dashboard:',
    '      - step:',
    '          name: Dependency dashboard',
    '          script:',
    '            - bun install --frozen-lockfile',
    '            - bunx buddy-bot dashboard --pin',
    '',
    '  pull-requests:',
    '    \'**\':',
    '      - step:',
    '          name: Buddy Bot check',
    '          script:',
    '            - bun install --frozen-lockfile',
    '            - bunx buddy-bot update-check --verbose',
  ]

  if (options.review) {
    lines.push(
      '          # Reviews the pull request this pipeline is running for.',
      '            - bunx buddy-bot review $BITBUCKET_PR_ID --verbose',
    )
  }

  return `${lines.join('\n')}\n`
}

/**
 * Pick the CI template for a provider.
 *
 * @param provider - Provider name
 * @param options - Whether to include the review job
 * @returns The file path to write and its content, or null for GitHub, whose
 * workflows are generated by the richer path in `src/setup.ts`
 */
export function ciTemplateFor(
  provider: string,
  options: { review?: boolean } = {},
): { path: string, content: string } | null {
  switch (provider) {
    case 'gitlab':
      return { path: '.gitlab-ci.yml', content: generateGitLabPipeline(options) }
    case 'bitbucket':
      return { path: 'bitbucket-pipelines.yml', content: generateBitbucketPipeline(options) }
    default:
      return null
  }
}
