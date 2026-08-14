import type { AiTool } from '../ai/types'

/**
 * What a tool is allowed to touch.
 *
 * Tiers are cumulative in capability but not in trust: a mode is granted a set
 * of tiers, and a tool outside those tiers is never offered to the model at
 * all rather than being offered and refused. A capability the model cannot see
 * is one it cannot be talked into using.
 */
export type ToolTier = 'read' | 'comment' | 'write' | 'shell' | 'git'

/** A tool the agent runtime can execute on the model's behalf. */
export interface AgentTool extends AiTool {
  /** Capability tier this tool belongs to */
  tier: ToolTier
  /**
   * Execute the call.
   *
   * @param input - Arguments the model supplied, unvalidated
   * @param context - Run context: paths, provider, logger
   * @returns Output handed back to the model
   */
  run: (input: Record<string, unknown>, context: AgentContext) => Promise<AgentToolOutput>
}

/** The result of running a tool. */
export interface AgentToolOutput {
  /** Text handed back to the model */
  content: string
  /**
   * Whether the content came from somewhere a third party controls — a PR
   * body, an issue comment, a fetched page. Marked so the runtime can frame it
   * as data rather than instructions.
   */
  untrusted?: boolean
  /** Whether the tool failed; the model sees the message either way */
  isError?: boolean
}

/** Everything a tool needs to do its work. */
export interface AgentContext {
  /** Absolute path the agent may operate within */
  workspace: string
  /** Branch the agent must not commit to */
  baseBranch: string
  /** Branch the agent is working on, when one exists */
  branch?: string
  /** Repository owner/name, for provider calls */
  repository?: { owner: string, name: string }
  /** Log a diagnostic line; already redaction-filtered by the runner */
  log: (message: string) => void
}

/** A named playbook plus the capabilities it may use. */
export interface AgentMode {
  name: string
  /** Instructions framing the task for this mode */
  playbook: string
  /** Tiers this mode may draw tools from */
  tiers: ToolTier[]
  /** Maximum tool calls before the run is stopped */
  maxToolCalls: number
}

/** One step in a run, recorded for observability. */
export interface TranscriptEntry {
  type: 'model' | 'tool' | 'error' | 'note'
  /** Milliseconds since the run started */
  at: number
  /** Tool name, for tool entries */
  name?: string
  /** Redacted summary of what happened */
  detail: string
  /** Output tokens spent, for model entries */
  outputTokens?: number
}

/** What a completed run produced. */
export interface AgentRunResult {
  /** The agent's final text output */
  output: string
  /** Why the run ended */
  stopReason: 'completed' | 'max_tool_calls' | 'timeout' | 'budget' | 'error'
  /** Every step taken, redacted */
  transcript: TranscriptEntry[]
  /** Total output tokens spent */
  outputTokens: number
  /** Number of tool calls executed */
  toolCalls: number
}

/** Raised when a tool is invoked outside its mode's permitted tiers. */
export class ToolPermissionError extends Error {
  constructor(toolName: string, tier: ToolTier, mode: string) {
    super(`Tool ${toolName} (${tier}) is not available in ${mode} mode`)
    this.name = 'ToolPermissionError'
  }
}
