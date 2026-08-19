import type Anthropic from '@anthropic-ai/sdk'
import type { AiCompletionRequest, AiProvider, AiResponse, AiToolCall } from '../types'
import { AiProviderError } from '../types'

/** Default output ceiling, sized to stay under the SDK's HTTP timeout. */
const DEFAULT_MAX_TOKENS = 16000

/**
 * Anthropic provider, backed by the official SDK.
 *
 * The SDK is used rather than raw fetch because it tracks the API's evolving
 * request surface — thinking configuration, effort, structured outputs and
 * error typing all changed shape across recent model generations.
 *
 * @param options - API key and optional gateway base URL
 * @returns A provider ready to complete requests
 */
export function createAnthropicProvider(options: { apiKey: string, baseUrl?: string }): AiProvider {
  let client: Anthropic | undefined

  /**
   * Resolve the SDK on first use, not at import time.
   *
   * The SDK is an optional peer: it is 7 MB installed, and buddy-bot reaches
   * for Anthropic only when a run both enables AI and resolves to this
   * provider. A static import would put those bytes in every install of every
   * project that merely has buddy-bot in its dev tooling — the overwhelmingly
   * common case, and one that never constructs a provider at all.
   */
  async function getClient(): Promise<Anthropic> {
    if (client)
      return client

    let AnthropicCtor: typeof Anthropic
    try {
      AnthropicCtor = (await import('@anthropic-ai/sdk')).default
    }
    catch {
      throw new AiProviderError(
        'The Anthropic provider needs @anthropic-ai/sdk, which is an optional peer dependency.\n'
        + 'Install it with: bun add @anthropic-ai/sdk',
        'anthropic',
      )
    }

    client = new AnthropicCtor({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    })
    return client
  }

  return {
    name: 'anthropic',

    async complete(request: AiCompletionRequest, model: string): Promise<AiResponse> {
      const outputConfig: Record<string, unknown> = {}
      if (request.effort)
        outputConfig.effort = request.effort
      if (request.jsonSchema)
        outputConfig.format = { type: 'json_schema', schema: request.jsonSchema }

      const response = await (await getClient()).messages.create({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages.map(message => ({
          role: message.role,
          content: message.content,
        })),
        ...(request.tools?.length
          ? {
              tools: request.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters as Anthropic.Tool['input_schema'],
              })),
            }
          : {}),
        ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
      } as Anthropic.MessageCreateParamsNonStreaming)

      let text = ''
      const toolCalls: AiToolCall[] = []

      for (const block of response.content) {
        if (block.type === 'text')
          text += block.text
        else if (block.type === 'tool_use')
          toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> })
      }

      return {
        text,
        toolCalls,
        json: parseJson(text, request.jsonSchema !== undefined),
        stopReason: mapStopReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          ...(response.usage.cache_read_input_tokens != null
            ? { cachedInputTokens: response.usage.cache_read_input_tokens }
            : {}),
        },
        model: response.model,
      }
    },
  }
}

/**
 * Map Anthropic's stop reasons onto the normalized set.
 *
 * `refusal` is preserved rather than folded into `other`: a refusal returns a
 * successful HTTP response with empty or partial content, so a caller that
 * cannot tell it apart will read the empty content as a valid answer.
 */
function mapStopReason(reason: string | null): AiResponse['stopReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end'
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    default:
      return 'other'
  }
}

function parseJson(text: string, expected: boolean): unknown {
  if (!expected)
    return undefined

  try {
    return JSON.parse(text)
  }
  catch {
    throw new AiProviderError('Model returned malformed JSON for a schema-constrained request', 'anthropic')
  }
}
