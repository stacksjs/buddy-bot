import type { Logger } from '../utils/logger'
import type { Analyzer, AnalysisResult } from './types'
import { createPathMatcher } from '../utils/globs'
import { commandExists } from './analyzers/external'
import { getDefaultLogger } from '../utils/logger'
import { actionlintAnalyzer } from './analyzers/actionlint'
import { githubActionsAnalyzer } from './analyzers/github-actions'
import { hadolintAnalyzer } from './analyzers/hadolint'
import { linterAnalyzer } from './analyzers/linter'
import { markdownlintAnalyzer } from './analyzers/markdownlint'
import { secretsAnalyzer } from './analyzers/secrets'
import { shellcheckAnalyzer } from './analyzers/shellcheck'
import { syntaxAnalyzer } from './analyzers/syntax'

// Re-exported from its home beside the other external-tool helpers, so an
// analyzer can probe for its binary without importing the engine that
// registers it — which would be a cycle.
export { commandExists }

/**
 * Analyzers registered by default, most consequential first.
 *
 * Native analyzers lead because they always run; the external ones follow and
 * report themselves as skipped when their tool is absent, so a thin runner
 * degrades coverage with a note rather than silently reading as clean.
 */
export const BUILTIN_ANALYZERS: Analyzer[] = [
  secretsAnalyzer,
  githubActionsAnalyzer,
  syntaxAnalyzer,
  linterAnalyzer,
  actionlintAnalyzer,
  shellcheckAnalyzer,
  hadolintAnalyzer,
  markdownlintAnalyzer,
]

/** Options for an analysis pass. */
export interface AnalysisOptions {
  /** Repository-relative paths to analyze */
  files: string[]
  /** Repository root */
  root: string
  /** Analyzers to consider; defaults to the built-in set */
  analyzers?: Analyzer[]
  /** Per-analyzer enable/disable from config */
  enabled?: Record<string, boolean>
  logger?: Logger
}

/**
 * Run every analyzer whose file types the change touches.
 *
 * Selection is by changed file rather than by repository content, so a change
 * that touches no workflows never pays for the workflow auditor.
 *
 * @param options - Files, root and analyzer configuration
 * @returns Findings, plus which analyzers ran and which were skipped
 * @example
 * ```ts
 * const result = await runAnalyzers({ files: ['src/app.ts'], root: process.cwd() })
 * console.log(result.findings.length, result.skipped)
 * ```
 */
export async function runAnalyzers(options: AnalysisOptions): Promise<AnalysisResult> {
  const logger = options.logger ?? getDefaultLogger()
  const analyzers = options.analyzers ?? BUILTIN_ANALYZERS

  const findings: AnalysisResult['findings'] = []
  const ran: AnalysisResult['ran'] = []
  const skipped: AnalysisResult['skipped'] = []

  for (const analyzer of analyzers) {
    if (options.enabled?.[analyzer.name] === false)
      continue

    const matcher = createPathMatcher(analyzer.filePatterns)
    const matched = options.files.filter(file => matcher.matches(file))
    if (matched.length === 0)
      continue

    if (!(await analyzer.available(options.root))) {
      // Reported rather than dropped: a silently skipped linter reads as
      // "clean" when it means "not checked".
      skipped.push({ name: analyzer.name, reason: 'tool not available on this runner' })
      logger.debug(`⏭️  Skipping ${analyzer.name}: not available`)
      continue
    }

    try {
      const produced = await analyzer.run(matched, options.root)
      findings.push(...produced)
      ran.push({ name: analyzer.name, findings: produced.length })
      logger.debug(`🔎 ${analyzer.name}: ${produced.length} finding(s) over ${matched.length} file(s)`)
    }
    catch (error) {
      // One analyzer failing must not lose the findings of the others.
      skipped.push({ name: analyzer.name, reason: error instanceof Error ? error.message : String(error) })
      logger.warn(`⚠️ ${analyzer.name} failed: ${error}`)
    }
  }

  return { findings, ran, skipped }
}
