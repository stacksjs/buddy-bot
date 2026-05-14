export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  /** Stable rule identifier — `unpinned-action`, `bash-injection`, … */
  ruleId: string
  /** Human-readable severity. `error`-level findings cause non-zero exit. */
  severity: Severity
  /** One-line summary; the reporter shows this first. */
  message: string
  /** Optional detail (multi-line) shown under the summary in pretty mode. */
  detail?: string
  /** Workflow file the finding applies to. Path relative to scan root. */
  file: string
  /** 1-based line number, when we can locate the offending text. */
  line?: number
  /** Optional remediation hint shown below the finding. */
  fix?: string
}

export interface ParsedWorkflow {
  /** Path relative to scan root (e.g. `.github/workflows/ci.yml`). */
  file: string
  /** Raw file text — rules use this for line-number lookups. */
  raw: string
  /** `Bun.YAML.parse` output. Loosely typed since YAML is permissive. */
  data: WorkflowData
}

/**
 * Loose shape of a GitHub Actions workflow. We only declare the fields we
 * inspect — the parser hands back whatever YAML produced and rules narrow
 * as needed.
 */
export interface WorkflowData {
  name?: string
  on?: WorkflowTriggers
  permissions?: WorkflowPermissions
  jobs?: Record<string, WorkflowJob>
  [key: string]: unknown
}

export type WorkflowTriggers =
  | string
  | string[]
  | Record<string, unknown>

export type WorkflowPermissions =
  | 'read-all'
  | 'write-all'
  | Record<string, 'read' | 'write' | 'none'>

export interface WorkflowJob {
  'name'?: string
  'runs-on'?: string | string[]
  'permissions'?: WorkflowPermissions
  'timeout-minutes'?: number
  'steps'?: WorkflowStep[]
  [key: string]: unknown
}

export interface WorkflowStep {
  name?: string
  uses?: string
  with?: Record<string, unknown>
  run?: string
  env?: Record<string, string>
  [key: string]: unknown
}

export interface Rule {
  /** Stable identifier — used in finding output and ignore lists. */
  id: string
  /** Default severity if the rule fires. Reporters honour this. */
  defaultSeverity: Severity
  /** One-line description shown by `gh-audit rules`. */
  description: string
  /** Run the rule against a single parsed workflow. */
  check: (workflow: ParsedWorkflow) => Finding[]
}

export interface AuditOptions {
  /**
   * Rules to run. Defaults to the full built-in set. Pass a subset to
   * narrow scope (e.g. when wiring buddy-bot to a focused security gate).
   */
  rules?: Rule[]
  /**
   * Rule IDs to skip even when enabled. Useful for repository-level
   * `.gh-auditignore` style overrides without rewriting the rule list.
   */
  ignore?: string[]
}

export interface AuditResult {
  workflows: ParsedWorkflow[]
  findings: Finding[]
  /** True when at least one `error` finding was produced. */
  failed: boolean
}
