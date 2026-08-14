export { attemptMajorUpgrade } from './migrate'
export type { UpgradeOptions, UpgradeResult } from './migrate'
export {
  buildAnalysisPrompt,
  isAllowedCodemod,
  MIGRATION_PLAN_SCHEMA,
  normalizePlan,
  shouldOpenAsDraft,
} from './plan'
export type { BreakingChange, MigrationConfidence, MigrationPlan } from './plan'
export { renderMigrationReport } from './report'
export type { MigrationOutcome } from './report'
export { findUsageSites, summarizeUsage } from './usage'
export type { UsageSite } from './usage'
export { collectSpanNotes, DEFAULT_SPAN_BUDGET, describeSpanGaps } from './span'
export type { ReleaseSpan, SpanRelease } from './span'
export { analyzeGroupMajors, appendUpgradeReport, matchesGlobs } from './wire'
export type { GroupUpgradeOptions, GroupUpgradeOutcome } from './wire'
