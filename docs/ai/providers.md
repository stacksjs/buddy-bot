# AI Providers

Buddy Bot's AI features are **bring-your-own-key**. You choose the provider and model; nothing is proxied through a third party, and no AI runs unless you configure a key.

With no key configured, every AI feature is a no-op and the dependency bot works exactly as it always has.

## Quick start

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

That's the whole setup — Buddy Bot picks up the key and uses a current Claude model by default.

## Supported providers

| Provider | Config value | Key environment variable | Default model |
|---|---|---|---|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-5` |
| OpenAI | `openai` | `OPENAI_API_KEY` | *(specify one)* |
| Google | `google` | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | *(specify one)* |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | *(specify one)* |
| OpenAI-compatible | `openai-compatible` | `OPENAI_COMPATIBLE_API_KEY` | *(specify one)* |

Only Anthropic has a built-in default model. For the others you must name a model — Buddy Bot won't guess at another vendor's catalogue and silently route your requests to a model you didn't choose.

## Configuration

```ts
// buddy-bot.config.ts
import type { BuddyBotConfig } from 'buddy-bot'

const config: BuddyBotConfig = {
  ai: {
    provider: 'anthropic',
    model: 'opus',
    effort: 'medium',
    maxTokensPerRun: 200_000,
  },
}

export default config
```

| Option | Type | Description | Default |
|---|---|---|---|
| `enabled` | `boolean` | Turn all AI features off even with a key present | `true` |
| `provider` | see table above | Which provider to use | first with a key |
| `model` | `string` | Alias or concrete model ID | provider default |
| `effort` | `'low' \| 'medium' \| 'high'` | Reasoning depth to request | provider default |
| `apiKeyEnv` | `string` | Environment variable holding the key | provider default |
| `baseUrl` | `string` | Endpoint override for gateways | provider default |
| `maxTokensPerRun` | `number` | Hard ceiling on output tokens per run | unlimited |

**`apiKeyEnv` is the *name* of an environment variable, not a key.** Config validation rejects anything key-shaped so a credential can't be committed to the repository by mistake.

## Model aliases

Short names resolve to current Anthropic models, so your config doesn't need editing when a new version ships:

| Alias | Resolves to |
|---|---|
| `claude`, `opus`, `claude-opus` | `claude-opus-5` |
| `sonnet`, `claude-sonnet` | `claude-sonnet-5` |
| `haiku`, `claude-haiku` | `claude-haiku-4-5` |
| `fable`, `claude-fable` | `claude-fable-5` |

Anything that isn't an alias is passed through unchanged, so a model released after this table was written works immediately.

## Auto-selection

With no `provider` set, Buddy Bot uses the first provider that has a key available, in the order **anthropic → openai → google → openrouter**. A blank or whitespace-only key counts as absent.

## Per-run overrides

```bash
BUDDY_BOT_MODEL=haiku buddy-bot scan
```

`BUDDY_BOT_MODEL` overrides the configured model for a single run — useful for testing a cheaper model without touching config.

## Gateways and self-hosted endpoints

Any OpenAI-compatible endpoint works through `baseUrl`:

```ts
ai: {
  provider: 'openai-compatible',
  baseUrl: 'https://gateway.internal/v1',
  model: 'your-model-id',
  apiKeyEnv: 'INTERNAL_GATEWAY_KEY',
}
```

For Anthropic behind a corporate gateway, set `baseUrl` to the gateway's origin.

## Budgets

`maxTokensPerRun` caps output tokens across a whole run. The check happens *before* each request, so an exhausted budget can't spend one more request's worth of tokens on its way out; further calls fail with `AiBudgetExceededError`.

## Security

- Keys are read from the environment and never written to config, logs, or PR bodies.
- Everything the AI layer logs passes through a redaction filter that masks provider keys, bearer tokens, GitHub tokens, and assignment-shaped secrets. Provider errors frequently echo request headers back, so this matters in practice.
- Buddy Bot never sends your source to a provider unless a feature you enabled explicitly does so.

## Programmatic use

```ts
import { createAiClient } from 'buddy-bot'

const ai = createAiClient(config)
if (!ai) {
  // No key configured — AI features are off.
  return
}

const response = await ai.complete({
  system: 'You summarize dependency changes.',
  messages: [{ role: 'user', content: 'Summarize: react 17 -> 18' }],
})

console.log(response.text, response.usage.outputTokens)
```

`complete()` returns the same normalized shape on every provider: `text`, `toolCalls`, optional parsed `json`, a `stopReason` of `end | tool_use | max_tokens | refusal | other`, and `usage`.

A `refusal` stop reason is reported as itself rather than folded into `end` — a refusal comes back as a successful response with empty content, so treating it as a normal completion would read that emptiness as a valid answer.
