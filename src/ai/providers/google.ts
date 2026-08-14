import type { AiCompletionRequest, AiProvider, AiResponse, AiToolCall } from '../types'
import { fetchWithTimeout } from '../../utils/http'
import { redact } from '../redact'
import { AiProviderError } from '../types'

const DEFAULT_MAX_TOKENS = 16000
const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiResponse {
  modelVersion?: string
  candidates?: Array<{
    finishReason?: string
    content?: {
      parts?: Array<{
        text?: string
        functionCall?: { name?: string, args?: Record<string, unknown> }
      }>
    }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    cachedContentTokenCount?: number
  }
}

/**
 * Google Gemini provider.
 *
 * Gemini's wire format differs enough from the OpenAI shape — `contents` with
 * `parts` rather than `messages`, `model` role rather than `assistant`, tools
 * nested under `functionDeclarations` — that it gets its own mapping rather
 * than a compatibility shim.
 *
 * @param options - API key and optional base URL
 */
export function createGoogleProvider(options: { apiKey: string, baseUrl?: string }): AiProvider {
  const baseUrl = (options.baseUrl ?? GOOGLE_BASE_URL).replace(/\/+$/, '')

  return {
    name: 'google',

    async complete(request: AiCompletionRequest, model: string): Promise<AiResponse> {
      const body: Record<string, unknown> = {
        contents: request.messages.map(message => ({
          // Gemini names the assistant role `model`.
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(request.jsonSchema
            ? { responseMimeType: 'application/json', responseSchema: request.jsonSchema }
            : {}),
        },
      }

      if (request.system)
        body.systemInstruction = { parts: [{ text: request.system }] }

      if (request.tools?.length) {
        body.tools = [{
          functionDeclarations: request.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }]
      }

      const response = await fetchWithTimeout(
        `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': options.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      )

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new AiProviderError(
          `google request failed: ${response.status} ${response.statusText} ${redact(detail.slice(0, 500))}`.trim(),
          'google',
          response.status,
        )
      }

      const payload = await response.json() as GeminiResponse
      const candidate = payload.candidates?.[0]

      let text = ''
      const toolCalls: AiToolCall[] = []

      for (const [index, part] of (candidate?.content?.parts ?? []).entries()) {
        if (part.text)
          text += part.text
        if (part.functionCall?.name) {
          // Gemini does not assign call IDs; synthesize a stable one so the
          // normalized shape can still pair a result with its call.
          toolCalls.push({
            id: `${part.functionCall.name}-${index}`,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          })
        }
      }

      return {
        text,
        toolCalls,
        json: request.jsonSchema ? parseJson(text) : undefined,
        stopReason: mapStopReason(candidate?.finishReason, toolCalls.length > 0),
        usage: {
          inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
          ...(payload.usageMetadata?.cachedContentTokenCount != null
            ? { cachedInputTokens: payload.usageMetadata.cachedContentTokenCount }
            : {}),
        },
        model: payload.modelVersion ?? model,
      }
    },
  }
}

function mapStopReason(reason: string | undefined, hasToolCalls: boolean): AiResponse['stopReason'] {
  if (hasToolCalls)
    return 'tool_use'

  switch (reason) {
    case 'STOP':
      return 'end'
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
      return 'refusal'
    default:
      return 'other'
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    throw new AiProviderError('Model returned malformed JSON for a schema-constrained request', 'google')
  }
}
