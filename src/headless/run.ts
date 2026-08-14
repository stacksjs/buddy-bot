import type { AiClient } from '../ai/types'
import type { Logger } from '../utils/logger'
import { getDefaultLogger } from '../utils/logger'

/** What a headless run produced. */
export interface HeadlessResult {
  /** The model's output: a string, or the parsed object when a schema was given */
  result: unknown
  /** Whether the output satisfied the schema */
  valid: boolean
  /** Why validation failed, when it did */
  error?: string
  /** How many attempts were needed */
  attempts: number
}

/** Inputs to a headless run. */
export interface HeadlessOptions {
  prompt: string
  ai: AiClient
  /** JSON Schema the output must satisfy */
  schema?: Record<string, unknown>
  /** How many times to re-ask on a schema violation (default: 2) */
  maxRetries?: number
  /** System prompt override */
  system?: string
  logger?: Logger
}

/** A schema violation, with the path that failed. */
export interface SchemaViolation {
  path: string
  message: string
}

/**
 * Check a value against a JSON Schema subset.
 *
 * Deliberately partial: `type`, `required`, `properties`, `items`, `enum`.
 * That is what an Actions step's `output_schema` realistically declares, and
 * implementing more would mean either a dependency or a half-correct
 * validator that passes things it should not — which is worse than a small
 * one that is right about what it covers.
 *
 * @param value - Value to check
 * @param schema - JSON Schema
 * @param path - Path prefix, used in messages
 * @returns Every violation found, empty when the value conforms
 */
export function validateAgainstSchema(value: unknown, schema: unknown, path: string = ''): SchemaViolation[] {
  if (typeof schema !== 'object' || schema === null)
    return []

  const spec = schema as Record<string, unknown>
  const at = path || '(root)'
  const violations: SchemaViolation[] = []

  if (typeof spec.type === 'string') {
    const actual = jsonTypeOf(value)
    // JSON Schema treats an integer as a number; the reverse is not true.
    const matches = spec.type === 'integer'
      ? Number.isInteger(value)
      : actual === spec.type || (spec.type === 'number' && actual === 'integer')

    if (!matches) {
      violations.push({ path: at, message: `expected ${spec.type}, got ${actual}` })
      // Everything below is typed against a shape this value does not have,
      // so continuing would produce cascading noise about the same mistake.
      return violations
    }
  }

  if (Array.isArray(spec.enum) && !spec.enum.includes(value as never))
    violations.push({ path: at, message: `expected one of ${spec.enum.map(entry => JSON.stringify(entry)).join(', ')}` })

  if (Array.isArray(spec.required) && typeof value === 'object' && value !== null) {
    for (const key of spec.required) {
      if (!(String(key) in (value as Record<string, unknown>)))
        violations.push({ path: path ? `${path}.${key}` : String(key), message: 'is required but missing' })
    }
  }

  if (typeof spec.properties === 'object' && spec.properties !== null && typeof value === 'object' && value !== null) {
    for (const [key, subSchema] of Object.entries(spec.properties as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== undefined)
        violations.push(...validateAgainstSchema(child, subSchema, path ? `${path}.${key}` : key))
    }
  }

  if (spec.items !== undefined && Array.isArray(value)) {
    value.forEach((entry, index) => {
      violations.push(...validateAgainstSchema(entry, spec.items, `${path}[${index}]`))
    })
  }

  return violations
}

function jsonTypeOf(value: unknown): string {
  if (value === null)
    return 'null'
  if (Array.isArray(value))
    return 'array'
  if (Number.isInteger(value))
    return 'integer'
  return typeof value
}

/**
 * Run a prompt headlessly, enforcing a schema when one is given.
 *
 * The contract is that a nonconforming output *fails*: a pipeline step whose
 * later steps do `fromJSON(...)` on the result needs the step to have failed
 * rather than to have emitted something shaped differently than promised.
 * Retries exist because a re-ask with the violations quoted back usually
 * succeeds, and burning the step on a formatting slip would be needless.
 *
 * @param options - Prompt, client and schema
 * @returns The result and whether it conformed
 * @example
 * ```ts
 * const outcome = await runHeadless({ prompt, ai, schema })
 * if (!outcome.valid)
 *   process.exit(1)
 * ```
 */
export async function runHeadless(options: HeadlessOptions): Promise<HeadlessResult> {
  const logger = options.logger ?? getDefaultLogger()
  const maxRetries = options.maxRetries ?? 2

  const system = options.system
    ?? 'You are running as a pipeline step. Answer the request directly and completely. '
      + 'There is no interactive user to ask follow-up questions of.'

  let lastError = ''

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const content = attempt === 1
      ? options.prompt
      : `${options.prompt}\n\nYour previous answer did not satisfy the required schema:\n${lastError}\n\nAnswer again, satisfying it exactly.`

    const response = await options.ai.complete({
      system,
      messages: [{ role: 'user', content }],
      ...(options.schema ? { jsonSchema: options.schema } : {}),
    })

    if (!options.schema)
      return { result: response.text, valid: true, attempts: attempt }

    const parsed = response.json ?? parseJson(response.text)
    if (parsed === undefined) {
      lastError = 'the output was not valid JSON'
      logger.warn(`⚠️ Attempt ${attempt}: ${lastError}`)
      continue
    }

    const violations = validateAgainstSchema(parsed, options.schema)
    if (violations.length === 0)
      return { result: parsed, valid: true, attempts: attempt }

    lastError = violations.map(violation => `- ${violation.path}: ${violation.message}`).join('\n')
    logger.warn(`⚠️ Attempt ${attempt} did not satisfy the schema:\n${lastError}`)
  }

  return { result: null, valid: false, error: lastError, attempts: maxRetries + 1 }
}

function parseJson(text: string): unknown {
  const start = text.search(/[[{]/)
  if (start === -1)
    return undefined

  try {
    return JSON.parse(text.slice(start))
  }
  catch {
    return undefined
  }
}

/**
 * Format a value for `$GITHUB_OUTPUT`.
 *
 * Multi-line values need heredoc syntax; the delimiter has to be absent from
 * the value or a crafted output could close the block early and inject further
 * outputs into the workflow — which is a real escalation when a later step
 * interpolates them.
 *
 * @param name - Output name
 * @param value - Value to write
 * @returns The line(s) to append to the file
 */
export function formatGithubOutput(name: string, value: string): string {
  if (!value.includes('\n'))
    return `${name}=${value}\n`

  let delimiter = 'BUDDY_EOF'
  let suffix = 0
  while (value.includes(delimiter))
    delimiter = `BUDDY_EOF_${++suffix}`

  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`
}

/**
 * Write a headless result to `$GITHUB_OUTPUT` when running in Actions.
 *
 * @param result - The value to publish
 * @param outputPath - Path from `GITHUB_OUTPUT`, absent outside Actions
 * @returns Whether it was written
 */
export async function publishOutput(result: unknown, outputPath: string | undefined): Promise<boolean> {
  if (!outputPath)
    return false

  const serialized = typeof result === 'string' ? result : JSON.stringify(result)
  const existing = await Bun.file(outputPath).exists() ? await Bun.file(outputPath).text() : ''
  await Bun.write(outputPath, existing + formatGithubOutput('result', serialized))

  return true
}
