import type { UsageSite } from './usage'

/** How confident the analysis is that a migration will succeed. */
export type MigrationConfidence = 'high' | 'medium' | 'low'

/** One breaking change and what it means for this repository. */
export interface BreakingChange {
  /** What upstream changed */
  description: string
  /** Version the change landed in */
  version?: string
  /** Files in this repository the change affects */
  affectedFiles: string[]
  /** What has to be done about it */
  action: string
  /** Whether the fix is mechanical enough to apply automatically */
  automatable: boolean
}

/** The analysis produced before any code is changed. */
export interface MigrationPlan {
  packageName: string
  fromVersion: string
  toVersion: string
  /** Breaking changes that affect this repository */
  changes: BreakingChange[]
  /** A codemod the package publishes, when one exists */
  codemod?: { command: string, source: string }
  confidence: MigrationConfidence
  /** Rough effort, 1 (trivial) to 5 (demanding) */
  effort: number
  /** Anything the analysis could not resolve */
  risks: string[]
}

/**
 * Schema the model's migration analysis is validated against.
 *
 * Constrained so a plan either names files that exist and actions that can be
 * executed, or fails validation — a free-form plan reads convincingly and
 * cannot be acted on.
 */
export const MIGRATION_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What upstream changed' },
          version: { type: 'string', description: 'Version the change landed in' },
          affectedFiles: { type: 'array', items: { type: 'string' } },
          action: { type: 'string', description: 'What must be done in this repository' },
          automatable: { type: 'boolean', description: 'Whether the fix is mechanical' },
        },
        required: ['description', 'affectedFiles', 'action', 'automatable'],
        additionalProperties: false,
      },
    },
    codemod: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command that applies the official codemod' },
        source: { type: 'string', description: 'Where the codemod is documented' },
      },
      required: ['command', 'source'],
      additionalProperties: false,
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    effort: { type: 'integer', description: '1 (trivial) to 5 (demanding)' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['changes', 'confidence', 'effort', 'risks'],
  additionalProperties: false,
}

/** Commands allowed to run as an official codemod. */
const CODEMOD_ALLOWLIST = [
  /^(?:bunx|npx|pnpm dlx|yarn dlx)\s+[\w@/.-]+(?:\s+[\w@/.:=-]+)*$/,
]

/**
 * Whether a codemod command is safe to execute.
 *
 * The command comes from a model reading a changelog, which means in the worst
 * case it comes from whoever wrote that changelog. Only a plain package runner
 * invocation is allowed — no shell operators, no redirection, nothing that
 * could chain a second command.
 *
 * @param command - Proposed codemod command
 */
export function isAllowedCodemod(command: string): boolean {
  const trimmed = command.trim()

  if (/[;&|`$><\n]/.test(trimmed))
    return false

  return CODEMOD_ALLOWLIST.some(pattern => pattern.test(trimmed))
}

/**
 * Build the analysis prompt for a major upgrade.
 *
 * @param input - Package, versions, release notes and where it is used
 */
export function buildAnalysisPrompt(input: {
  packageName: string
  fromVersion: string
  toVersion: string
  releaseNotes: string
  usage: UsageSite[]
}): string {
  const usageLines = input.usage
    .slice(0, 100)
    .map(site => `${site.path}:${site.line} (${site.kind}) ${site.text}`)
    .join('\n')

  return [
    `Analyse upgrading \`${input.packageName}\` from ${input.fromVersion} to ${input.toVersion}.`,
    '',
    'Report only breaking changes that affect THIS repository, judged against the',
    'usage sites below. A breaking change in a feature this repository does not use',
    'is not worth reporting, and listing it makes the real ones harder to find.',
    '',
    'Mark a change automatable only when the fix is a mechanical edit you could write',
    'exactly. Anything needing judgement is not automatable.',
    '',
    'If the package publishes an official codemod for this upgrade, report the command.',
    '',
    'Set confidence honestly: high when every change is understood and mechanical,',
    'low when the notes are unclear or the change touches something subtle. A low',
    'confidence plan is more useful than a wrong high confidence one.',
    '',
    '--- Release notes across the version span ---',
    input.releaseNotes || '(none available)',
    '',
    `--- Usage in this repository (${input.usage.length} site(s)) ---`,
    usageLines || '(no direct usage found)',
  ].join('\n')
}

/**
 * Validate and normalize a plan returned by the model.
 *
 * Files the model named that do not appear in the known usage set are dropped:
 * a plan that edits a file it never saw is guessing, and acting on it is how a
 * migration corrupts unrelated code.
 *
 * @param raw - Parsed model output
 * @param context - Package identity and the files known to use it
 * @returns A plan safe to act on
 */
export function normalizePlan(
  raw: unknown,
  context: { packageName: string, fromVersion: string, toVersion: string, knownFiles: string[] },
): MigrationPlan {
  const payload = (raw ?? {}) as Partial<MigrationPlan>
  const known = new Set(context.knownFiles)

  const changes: BreakingChange[] = (Array.isArray(payload.changes) ? payload.changes : [])
    .filter((change): change is BreakingChange =>
      Boolean(change && typeof change.description === 'string' && typeof change.action === 'string'))
    .map(change => ({
      description: change.description,
      ...(change.version ? { version: change.version } : {}),
      affectedFiles: (Array.isArray(change.affectedFiles) ? change.affectedFiles : []).filter(file => known.has(file)),
      action: change.action,
      automatable: change.automatable === true,
    }))

  const codemod = payload.codemod && isAllowedCodemod(payload.codemod.command)
    ? payload.codemod
    : undefined

  return {
    packageName: context.packageName,
    fromVersion: context.fromVersion,
    toVersion: context.toVersion,
    changes,
    ...(codemod ? { codemod } : {}),
    confidence: normalizeConfidence(payload.confidence, changes),
    effort: clampEffort(payload.effort),
    risks: (Array.isArray(payload.risks) ? payload.risks : []).filter(risk => typeof risk === 'string'),
  }
}

/**
 * Whether a plan should open as a draft rather than a ready pull request.
 *
 * Anything below the configured confidence floor opens as a draft, because a
 * migration a maintainer has to check is one that should not look finished.
 *
 * @param plan - Normalized plan
 * @param floor - Minimum confidence to open ready
 */
export function shouldOpenAsDraft(plan: MigrationPlan, floor: MigrationConfidence = 'high'): boolean {
  const rank: Record<MigrationConfidence, number> = { low: 0, medium: 1, high: 2 }
  return rank[plan.confidence] < rank[floor]
}

/**
 * Downgrade a stated confidence the plan's own content does not support.
 *
 * A model reporting `high` alongside a change it marked non-automatable is
 * contradicting itself, and the conservative reading is the safe one.
 */
function normalizeConfidence(stated: unknown, changes: BreakingChange[]): MigrationConfidence {
  const value = stated === 'high' || stated === 'medium' || stated === 'low' ? stated : 'low'

  if (value === 'high' && changes.some(change => !change.automatable))
    return 'medium'

  return value
}

function clampEffort(value: unknown): number {
  const effort = Number(value)
  if (!Number.isFinite(effort))
    return 3
  return Math.min(5, Math.max(1, Math.round(effort)))
}
