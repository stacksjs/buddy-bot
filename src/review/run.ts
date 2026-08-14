import type { GitProvider } from '../git/provider'
import { assertSupports } from '../git/provider'
import type { BuddyBotConfig } from '../types'
import type { Logger } from '../utils/logger'
import { createAiClient, loadLearnings, renderLearnings, selectLearnings } from '../ai'
import { runAnalyzers } from '../analysis/engine'
import { getDefaultLogger } from '../utils/logger'
import { parseUnifiedDiff } from './diff'
import { reviewDiff } from './engine'
import { composeInstructions, loadGuidelines } from './guidelines'
import { needsReview, parseReviewState } from './marker'
import { prepareReview } from './poster'

/** Inputs to a full review of a pull request. */
export interface RunReviewOptions {
  config: BuddyBotConfig
  provider: GitProvider
  prNumber: number
  /** Ignore previously reported findings and review the whole diff again */
  full?: boolean
  /** Post only the summary and walkthrough */
  summaryOnly?: boolean
  /** Skip when the head commit was already reviewed */
  skipIfReviewed?: boolean
  logger?: Logger
}

/**
 * Review a pull request end to end and post the result.
 *
 * Shared by the CLI, the `@buddy-bot review` command and the automatic
 * trigger, so all three assemble context — guidelines, learnings, analyzer
 * findings — the same way rather than drifting apart.
 *
 * @param options - Repository context and review settings
 * @returns A short status line describing what happened
 */
export async function runReviewForPR(options: RunReviewOptions): Promise<string> {
  const logger = options.logger ?? getDefaultLogger()
  const { config, provider, prNumber } = options

  const prs = await provider.getPullRequests('open')
  const pr = prs.find(candidate => candidate.number === prNumber)
  if (!pr)
    return `Could not find open pull request #${prNumber}.`

  const state = parseReviewState(pr.body)
  if (state?.paused && !options.full)
    return 'Reviews are paused on this pull request. Say `@buddy-bot resume` to restart them.'

  const diff = await provider.getPullRequestDiff(prNumber)
  if (!diff.trim())
    return 'There are no changes to review.'

  const parsed = parseUnifiedDiff(diff)
  const changedFiles = parsed.files.map(file => file.path)
  const headSha = await provider.getPullRequestHeadSha(prNumber)

  if (options.skipIfReviewed && !needsReview(state, headSha)) {
    logger.info(`🔍 PR #${prNumber} already reviewed at ${headSha}`)
    return 'Already reviewed at this commit.'
  }

  const ai = createAiClient(config, logger)

  // Analyzers run whether or not AI is configured, so a repository without a
  // key still gets secret scanning and workflow auditing on its pull requests.
  const analysis = await runAnalyzers({ files: changedFiles, root: process.cwd(), logger })
  if (analysis.skipped.length > 0)
    logger.info(`⏭️  Skipped ${analysis.skipped.length} analyzer(s): ${analysis.skipped.map(entry => entry.name).join(', ')}`)

  if (!ai) {
    if (analysis.findings.length === 0)
      return 'No AI provider configured and static analysis found nothing to report.'

    const prepared = prepareReview(
      {
        summary: 'Static analysis only — no AI provider is configured.',
        walkthrough: [],
        findings: analysis.findings,
        effort: 1,
        omittedFiles: [],
      },
      { headSha, requestChangesOn: config.ai?.review?.requestChangesOn },
    )

    assertSupports(provider, 'inlineReviewComments', 'createReview', 'posting a review')
    await provider.createReview(prNumber, prepared)
    return `Posted ${analysis.findings.length} static-analysis finding(s).`
  }

  // Guidelines and learnings are read from the base branch: both are inlined
  // into the prompt as trusted context, so reading them from the pull
  // request's own branch would let it rewrite its own review instructions.
  const baseRef = pr.base || config.repository?.baseBranch || 'main'
  const readAtRef = (path: string, ref: string): Promise<string | null> => provider.getFileContent(path, ref)

  const [guidelines, learnings] = await Promise.all([
    loadGuidelines(readAtRef, baseRef, config.ai?.review?.guidelineFiles, logger),
    loadLearnings(readAtRef, baseRef, undefined, logger),
  ])

  const result = await reviewDiff(ai, {
    diff,
    profile: config.ai?.review?.profile,
    summaryOnly: options.summaryOnly ?? config.ai?.review?.summaryOnly,
    instructions: composeInstructions({
      global: config.ai?.review?.instructions,
      guidelines,
    }),
    learnings: renderLearnings(selectLearnings(learnings, changedFiles)),
    pathFilters: config.ai?.review?.pathFilters,
    pathInstructions: config.ai?.review?.pathInstructions,
    analyzerFindings: analysis.findings,
    // A full review deliberately forgets what was already reported, which is
    // the only way to get a dismissed finding back.
    seenFingerprints: options.full ? [] : state?.fingerprints ?? [],
    logger,
  })

  const prepared = prepareReview(result, {
    headSha,
    requestChangesOn: config.ai?.review?.requestChangesOn,
    seenFingerprints: options.full ? [] : state?.fingerprints ?? [],
  })

  assertSupports(provider, 'inlineReviewComments', 'createReview', 'posting a review')
  await provider.createReview(prNumber, prepared)

  return result.findings.length === 0
    ? 'Reviewed — nothing to report.'
    : `Reviewed — ${result.findings.length} finding(s) posted.`
}
