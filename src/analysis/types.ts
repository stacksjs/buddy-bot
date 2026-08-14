import type { ReviewFinding } from '../review/findings'

/** A source of findings over a set of files. */
export interface Analyzer {
  /** Stable identifier, surfaced on each finding as its tool */
  name: string
  /**
   * Globs the analyzer applies to. Selection is by changed file, so an
   * analyzer whose file types are untouched costs nothing on that run.
   */
  filePatterns: string[]
  /**
   * Whether the analyzer can run here.
   *
   * External tools report unavailability instead of failing, so a missing
   * binary degrades coverage with a note rather than breaking the run.
   *
   * @param root - Repository root, for analyzers whose availability depends
   * on repository content rather than on a binary being installed
   */
  available: (root: string) => Promise<boolean>
  /**
   * Analyze the given files.
   *
   * @param files - Repository-relative paths matching this analyzer's patterns
   * @param root - Repository root
   */
  run: (files: string[], root: string) => Promise<ReviewFinding[]>
}

/** What an analysis pass produced. */
export interface AnalysisResult {
  findings: ReviewFinding[]
  /** Analyzers that ran, with how many findings each produced */
  ran: Array<{ name: string, findings: number }>
  /**
   * Analyzers that matched files but could not run.
   *
   * Reported rather than dropped: silently skipping a linter reads as "clean"
   * when it means "not checked".
   */
  skipped: Array<{ name: string, reason: string }>
}
