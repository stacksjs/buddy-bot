import type { AiTool } from '../ai/types'
import type { AgentContext, AgentMode, AgentTool, AgentToolOutput } from './types'
import { fsTools } from './tools/fs'
import { shellTool } from './tools/shell'
import { ToolPermissionError } from './types'

/** Every tool the runtime knows about, before any mode filtering. */
export const BUILTIN_TOOLS: AgentTool[] = [...fsTools, shellTool]

/**
 * A mode's usable tools, and the means to run one.
 *
 * Filtering happens once, at construction: a tool outside the mode's tiers is
 * never converted into a model-visible definition, so the model cannot request
 * what it was never told exists. `invoke` re-checks anyway, because a caller
 * assembling a belt by hand should not be able to bypass the boundary.
 */
export class Toolbelt {
  private readonly tools = new Map<string, AgentTool>()

  constructor(
    private readonly mode: AgentMode,
    tools: AgentTool[] = BUILTIN_TOOLS,
  ) {
    for (const tool of tools) {
      if (mode.tiers.includes(tool.tier))
        this.tools.set(tool.name, tool)
    }
  }

  /** Tool definitions to advertise to the model. */
  definitions(): AiTool[] {
    return [...this.tools.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }))
  }

  /** Names of the tools available in this mode. */
  names(): string[] {
    return [...this.tools.keys()]
  }

  /** Whether a tool is available in this mode. */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Run a tool the model asked for.
   *
   * A tool outside the mode's tiers throws rather than returning an error
   * result: an out-of-tier call means either a bug or an attempt to reach past
   * the boundary, and neither should be reported to the model as a routine
   * failure it might retry differently.
   *
   * @param name - Tool the model named
   * @param input - Arguments the model supplied
   * @param context - Run context
   * @throws {ToolPermissionError} When the tool is not available in this mode
   */
  async invoke(
    name: string,
    input: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentToolOutput> {
    const tool = this.tools.get(name)

    if (!tool) {
      const known = BUILTIN_TOOLS.find(candidate => candidate.name === name)
      if (known)
        throw new ToolPermissionError(name, known.tier, this.mode.name)

      return { content: `No such tool: ${name}`, isError: true }
    }

    try {
      return await tool.run(input, context)
    }
    catch (error) {
      // A tool that throws is reported to the model so it can adapt, unlike a
      // permission violation, which is not the model's to work around.
      return { content: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true }
    }
  }
}
