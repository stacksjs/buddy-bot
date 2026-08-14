import type { AiClient } from '../ai/types'
import type { GitProvider } from '../git/provider'
import type { PullRequest } from '../types'
import type { Logger } from '../utils/logger'
import type { FinishingTouch } from './tasks'
import process from 'node:process'
import { getDefaultLogger } from '../utils/logger'
import { runAgent } from './runner'

/** How a finishing touch was delivered. */
export type DeliveryMode = 'stacked-pr' | 'suggestions' | 'none'

/** What running a finishing touch produced. */
export interface StackedResult {
  mode: DeliveryMode
  /** The stacked pull request, when one was opened */
  pullRequest?: PullRequest
  /** Files the agent changed */
  changedFiles: string[]
  /** Whether the repository's tests passed after the change */
  verified: boolean
  /** What to say back on the original pull request */
  comment: string
}

/** Commands that run a repository's tests, in preference order. */
export const TEST_COMMANDS: string[][] = [
  ['bun', 'test'],
  ['npm', 'test', '--silent'],
]

/** What verifying a change found. */
export interface Verification {
  ran: boolean
  passed: boolean
  output: string
}

/**
 * Run the repository's tests.
 *
 * Reports `ran: false` rather than `passed: false` when there is no test
 * script: a repository without tests has not failed verification, it has
 * declined it, and treating the two the same would downgrade every finishing
 * touch in every untested repository.
 *
 * @param dir - Repository root
 * @param command - Explicit command, else the first that applies
 * @returns Whether tests ran and whether they passed
 */
export async function verifyChanges(
  dir: string,
  command?: string[],
): Promise<Verification> {
  const candidates = command ? [command] : await applicableCommands(dir)

  for (const candidate of candidates) {
    const proc = Bun.spawn(candidate, {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', CI: '1' },
    })

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    return {
      ran: true,
      passed: exitCode === 0,
      output: `${stdout}\n${stderr}`.trim().slice(-4000),
    }
  }

  return { ran: false, passed: false, output: '' }
}

/** Which test commands this repository actually supports. */
async function applicableCommands(dir: string): Promise<string[][]> {
  const manifest = Bun.file(`${dir}/package.json`)
  if (!(await manifest.exists()))
    return []

  try {
    const parsed = await manifest.json() as { scripts?: Record<string, string> }
    // Only run a command the repository declared. Guessing `bun test` at a
    // project with no test script runs zero tests and reports success, which
    // would let an unverified change through as verified.
    return parsed.scripts?.test ? TEST_COMMANDS : []
  }
  catch {
    return []
  }
}

/** Inputs to a stacked finishing touch. */
export interface StackedOptions {
  provider: GitProvider
  /** The pull request the touch was requested on */
  pullRequest: PullRequest
  touch: FinishingTouch
  ai: AiClient
  workspace: string
  /** Explicit test command, else detected */
  testCommand?: string[]
  /** Files the agent may consider, for context */
  files?: string[]
  logger?: Logger
}

/** Branch name for a touch stacked on a pull request. */
export function stackedBranchName(pullRequest: PullRequest, touch: string): string {
  return `${pullRequest.head}/buddy-${touch}`
}

/**
 * Run a finishing touch and deliver it as a stacked pull request.
 *
 * The delivery is what makes this safe. Buddy Bot never commits to the
 * contributor's branch — it opens a pull request *targeting* that branch, so
 * the contributor reviews and merges it themselves. Writing directly would
 * mean agent-authored commits appearing under someone else's name on a branch
 * they are responsible for, which is not a trade worth making for convenience.
 *
 * When verification fails, the change is not published as a branch at all: it
 * comes back as committable suggestions on the original pull request, clearly
 * marked as unverified. A stacked PR that does not build is worse than a
 * comment, because it looks finished.
 *
 * @param options - Provider, pull request, touch and clients
 * @returns How it was delivered and what to say back
 * @example
 * ```ts
 * const result = await runStackedTouch({ provider, pullRequest, touch, ai, workspace })
 * await provider.createComment(pullRequest.number, result.comment)
 * ```
 */
export async function runStackedTouch(options: StackedOptions): Promise<StackedResult> {
  const logger = options.logger ?? getDefaultLogger()
  const { provider, pullRequest, touch } = options

  logger.info(`✨ Running finishing touch '${touch.name}' on PR #${pullRequest.number}`)

  const agentResult = await runAgent(options.ai, {
    mode: touch.mode,
    task: touch.buildTask({
      summary: pullRequest.title,
      files: options.files ?? [],
    }),
    context: {
      workspace: options.workspace,
      baseBranch: pullRequest.base,
      branch: pullRequest.head,
    },
    logger,
  })

  // Derived from git rather than from the agent's own account of what it did.
  // An agent that reports a file it did not touch, or omits one it did, would
  // otherwise decide what gets committed.
  const changedFiles = await detectChangedFiles(options.workspace)

  if (changedFiles.length === 0) {
    return {
      mode: 'none',
      changedFiles: [],
      verified: false,
      comment: agentResult.stopReason === 'completed'
        ? `**${touch.description}** — nothing to change.`
        : `**${touch.description}** — stopped before finishing (${agentResult.stopReason}), and left nothing behind.`,
    }
  }

  // An agent that hit a limit mid-edit has left the tree in a state it did not
  // choose. Publishing that as a branch would present an interrupted change as
  // a considered one, so it degrades to suggestions regardless of the tests.
  const completed = agentResult.stopReason === 'completed'

  const verification = await verifyChanges(options.workspace, options.testCommand)

  // A touch that declares itself suggestion-only never opens a branch, and an
  // unverified change never does either.
  const shouldStack = completed
    && touch.defaultOutput !== 'suggestion'
    && (verification.passed || !verification.ran)

  if (!shouldStack) {
    return {
      mode: 'suggestions',
      changedFiles,
      verified: verification.passed,
      comment: renderSuggestionComment(touch, changedFiles, verification, agentResult.stopReason),
    }
  }

  const branch = stackedBranchName(pullRequest, touch.name)

  try {
    // Branched from the pull request's head, and targeting it: the stack sits
    // on top of the contributor's work rather than beside it.
    await provider.createBranch(branch, pullRequest.head)
    await provider.commitChanges(
      branch,
      `chore: ${touch.description.toLowerCase()} for #${pullRequest.number}`,
      await readChangedFiles(options.workspace, changedFiles),
      pullRequest.head,
    )

    const stacked = await provider.createPullRequest({
      title: `${touch.description} for #${pullRequest.number}`,
      body: renderStackedBody(touch, pullRequest, changedFiles, verification),
      head: branch,
      base: pullRequest.head,
      labels: ['buddy-bot', 'finishing-touch'],
    })

    return {
      mode: 'stacked-pr',
      pullRequest: stacked,
      changedFiles,
      verified: verification.passed,
      comment: `**${touch.description}** — opened [#${stacked.number}](${stacked.url}) targeting this branch.`
        + (verification.ran ? '' : ' No test script was found, so this is unverified.'),
    }
  }
  catch (error) {
    // Falling back to suggestions rather than failing: the work is done, and
    // losing it because a branch could not be pushed would waste it.
    logger.warn(`⚠️ Could not open a stacked pull request: ${error}`)

    return {
      mode: 'suggestions',
      changedFiles,
      verified: verification.passed,
      comment: renderSuggestionComment(touch, changedFiles, verification, agentResult.stopReason),
    }
  }
}

/**
 * Files the working tree has modified, according to git.
 *
 * Deletions are excluded: a stacked pull request that removes a contributor's
 * file is a much larger claim than one that edits it, and a finishing touch
 * has no business making it.
 *
 * @param workspace - Repository directory
 * @returns Repository-relative paths
 */
export async function detectChangedFiles(workspace: string): Promise<string[]> {
  const proc = Bun.spawn(['git', 'status', '--porcelain'], {
    cwd: workspace,
    stdout: 'pipe',
    stderr: 'ignore',
  })

  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])

  if (exitCode !== 0)
    return []

  const files: string[] = []

  for (const line of stdout.split('\n')) {
    if (!line.trim())
      continue

    const status = line.slice(0, 2)
    const path = line.slice(3).trim()

    // ` D`/`D ` are deletions; `??` is an untracked file the agent created.
    if (status.includes('D'))
      continue

    // A rename reports `old -> new`; the new path is what exists now.
    files.push(path.includes(' -> ') ? path.split(' -> ')[1] : path)
  }

  return files
}

/** Read the agent's changed files back for committing. */
async function readChangedFiles(
  workspace: string,
  paths: string[],
): Promise<Array<{ path: string, content: string, type: 'update' }>> {
  const files: Array<{ path: string, content: string, type: 'update' }> = []

  for (const path of paths) {
    const file = Bun.file(`${workspace}/${path}`)
    if (await file.exists())
      files.push({ path, content: await file.text(), type: 'update' })
  }

  return files
}

/** Body for a stacked pull request. */
function renderStackedBody(
  touch: FinishingTouch,
  target: PullRequest,
  changedFiles: string[],
  verification: Verification,
): string {
  return [
    `${touch.description}, requested on #${target.number}.`,
    '',
    `This targets \`${target.head}\` rather than \`${target.base}\`, so merging it`,
    'adds these changes to that pull request.',
    '',
    verification.ran
      ? verification.passed
        ? '✅ The repository\'s tests pass with these changes.'
        : '⚠️ The repository\'s tests do **not** pass with these changes.'
      : 'ℹ️ No test script was found, so these changes are unverified.',
    '',
    '### Files changed',
    '',
    ...changedFiles.map(file => `- \`${file}\``),
  ].join('\n')
}

/** Comment for a touch delivered as suggestions rather than a branch. */
function renderSuggestionComment(
  touch: FinishingTouch,
  changedFiles: string[],
  verification: Verification,
  stopReason?: string,
): string {
  const lines = [`**${touch.description}**`, '']

  if (stopReason && stopReason !== 'completed') {
    lines.push(
      `The agent stopped before finishing (${stopReason}), so what follows is`,
      'partial work rather than a complete change.',
      '',
    )
  }

  if (verification.ran && !verification.passed) {
    // Said plainly. A change that does not build, presented as finished, costs
    // more than one presented as a starting point.
    lines.push(
      'The repository\'s tests do not pass with these changes, so no branch was',
      'opened. Treat what follows as a starting point rather than a result.',
      '',
    )
  }

  lines.push('Files that would change:', '', ...changedFiles.map(file => `- \`${file}\``))

  if (verification.output) {
    lines.push('', '<details><summary>Test output</summary>', '', '```', verification.output, '```', '', '</details>')
  }

  return lines.join('\n')
}
