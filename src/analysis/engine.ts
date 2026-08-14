import type { Logger } from '../utils/logger'
import type { Analyzer, AnalysisResult } from './types'
import { createPathMatcher } from '../utils/globs'
import { getDefaultLogger } from '../utils/logger'
import { githubActionsAnalyzer } from './analyzers/github-actions'
import { secretsAnalyzer } from './analyzers/secrets'

/** Analyzers registered by default. */
export const BUILTIN_ANALYZERS: Analyzer[] = [secretsAnalyzer, githubActionsAnalyzer]

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

    if (!(await analyzer.available())) {
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

/**
 * Whether a command exists on this runner.
 *
 * Shared by external-tool analyzers so each does not reimplement the probe.
 *
 * @param command - Executable name
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', command], { stdout: 'ignore', stderr: 'ignore' })
    return await proc.exited === 0
  }
  catch {
    return false
  }
}
