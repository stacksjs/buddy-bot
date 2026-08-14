/** Providers buddy-bot can talk to. */
export type AiProviderName = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'openai-compatible'

/**
 * How much reasoning depth to spend on a request.
 *
 * Mapped per provider: an effort level on Anthropic, a reasoning setting on
 * providers that expose one, and ignored where the concept has no equivalent.
 */
export type AiEffort = 'low' | 'medium' | 'high'

/** A conversation turn. */
export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

/** A tool the model may call. */
export interface AiTool {
  name: string
  description: string
  /** JSON Schema for the tool's arguments */
  parameters: Record<string, unknown>
}

/** A tool call the model asked for. */
export interface AiToolCall {
  /** Provider-assigned identifier, echoed back with the result */
  id: string
  name: string
  input: Record<string, unknown>
}

/** Normalized token accounting, in the shape every provider is mapped onto. */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
  /** Tokens served from a provider-side cache, when reported */
  cachedInputTokens?: number
}

/** What a completion returned. */
export interface AiResponse {
  /** Concatenated text content, empty when the model only called tools */
  text: string
  /** Tool calls the model requested */
  toolCalls: AiToolCall[]
  /** Parsed object when the request asked for structured output */
  json?: unknown
  /** Why generation ended, normalized across providers */
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'
  usage: AiUsage
  /** Concrete model that served the request */
  model: string
}

/** A completion request, in provider-neutral form. */
export interface AiCompletionRequest {
  /** Instructions that frame the whole request */
  system?: string
  messages: AiMessage[]
  tools?: AiTool[]
  /** Maximum tokens to generate (default: 16000) */
  maxTokens?: number
  /** Reasoning depth; falls back to the configured default */
  effort?: AiEffort
  /**
   * Ask for a JSON object matching this schema. The response's `json` field
   * carries the parsed value, and `text` the raw string.
   */
  jsonSchema?: Record<string, unknown>
  /** Model override for this request only */
  model?: string
}

/** A configured connection to one provider. */
export interface AiClient {
  readonly provider: AiProviderName
  /** Concrete model this client resolves to by default */
  readonly model: string
  /** Output tokens spent so far, for budget reporting */
  readonly tokensUsed: number
  complete: (request: AiCompletionRequest) => Promise<AiResponse>
}

/** The provider-specific half of a client, before budget and retry wrapping. */
export interface AiProvider {
  readonly name: AiProviderName
  complete: (request: AiCompletionRequest, model: string) => Promise<AiResponse>
}

/** Raised when a run exceeds its configured token budget. */
export class AiBudgetExceededError extends Error {
  constructor(
    public readonly spent: number,
    public readonly budget: number,
  ) {
    super(`AI token budget exceeded: ${spent} of ${budget} output tokens used`)
    this.name = 'AiBudgetExceededError'
  }
}

/** Raised when a provider rejects a request or returns an unusable response. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: AiProviderName,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}
