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
