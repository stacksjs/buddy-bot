import type { AiCompletionRequest, AiProvider, AiProviderName, AiResponse, AiToolCall } from '../types'
import { fetchWithTimeout } from '../../utils/http'
import { redact } from '../redact'
import { AiProviderError } from '../types'

const DEFAULT_MAX_TOKENS = 16000
const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

interface ChatCompletionResponse {
  model?: string
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string | null
      tool_calls?: Array<{ id: string, function?: { name?: string, arguments?: string } }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
}

/**
 * Provider for any OpenAI-compatible chat-completions endpoint.
 *
 * One implementation serves OpenAI, OpenRouter and self-hosted gateways
 * because they share a wire format — which is also why this provider takes a
 * base URL rather than hard-coding a host.
 *
 * @param options - Provider identity, credentials and endpoint
 */
export function createOpenAiProvider(options: {
  apiKey: string
  baseUrl?: string
  provider?: AiProviderName
}): AiProvider {
  const name = options.provider ?? 'openai'
  const baseUrl = (options.baseUrl ?? defaultBaseUrl(name)).replace(/\/+$/, '')

  return {
    name,

    async complete(request: AiCompletionRequest, model: string): Promise<AiResponse> {
      const messages: Array<Record<string, unknown>> = []
      if (request.system)
        messages.push({ role: 'system', content: request.system })
      for (const message of request.messages)
        messages.push({ role: message.role, content: message.content })

      const body: Record<string, unknown> = {
        model,
        messages,
        max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      }

      if (request.tools?.length) {
        body.tools = request.tools.map(tool => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }))
      }

      if (request.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'response', schema: request.jsonSchema, strict: true },
        }
      }

      // Providers that don't implement reasoning effort ignore the field; ones
      // that do read it under this name.
      if (request.effort)
        body.reasoning_effort = request.effort

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      }
      if (name === 'openrouter') {
        headers['HTTP-Referer'] = 'https://github.com/stacksjs/buddy-bot'
        headers['X-Title'] = 'buddy-bot'
      }

      const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new AiProviderError(
          `${name} request failed: ${response.status} ${response.statusText} ${redact(detail.slice(0, 500))}`.trim(),
          name,
          response.status,
        )
      }

      const payload = await response.json() as ChatCompletionResponse
      const choice = payload.choices?.[0]
      const text = choice?.message?.content ?? ''

      const toolCalls: AiToolCall[] = (choice?.message?.tool_calls ?? []).map(call => ({
        id: call.id,
        name: call.function?.name ?? '',
        input: safeParseArguments(call.function?.arguments, name),
      }))

      return {
        text,
        toolCalls,
        json: request.jsonSchema ? parseJson(text, name) : undefined,
        stopReason: mapStopReason(choice?.finish_reason, toolCalls.length > 0),
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
          ...(payload.usage?.prompt_tokens_details?.cached_tokens != null
            ? { cachedInputTokens: payload.usage.prompt_tokens_details.cached_tokens }
            : {}),
        },
        model: payload.model ?? model,
      }
    },
  }
}

function defaultBaseUrl(provider: AiProviderName): string {
  return provider === 'openrouter' ? OPENROUTER_BASE_URL : OPENAI_BASE_URL
}

function mapStopReason(reason: string | undefined, hasToolCalls: boolean): AiResponse['stopReason'] {
  if (hasToolCalls || reason === 'tool_calls')
    return 'tool_use'

  switch (reason) {
    case 'stop':
      return 'end'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    default:
      return 'other'
  }
}

function safeParseArguments(args: string | undefined, provider: AiProviderName): Record<string, unknown> {
  if (!args)
    return {}

  try {
    return JSON.parse(args) as Record<string, unknown>
  }
  catch {
    throw new AiProviderError('Model returned malformed JSON tool arguments', provider)
  }
}

function parseJson(text: string, provider: AiProviderName): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    throw new AiProviderError('Model returned malformed JSON for a schema-constrained request', provider)
  }
}
