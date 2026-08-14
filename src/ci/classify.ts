/** What kind of failure a CI log describes. */
export type FailureKind =
  /** Lock file out of step with its manifest; fixable mechanically */
  | 'lockfile-drift'
  /** Network, rate limit or runner flake; worth one retry */
  | 'flake'
  /** Type or compile error in the changed code */
  | 'type-error'
  /** A test assertion failed */
  | 'test-failure'
  /** Lint or format violation */
  | 'lint'
  /** Dependency could not be resolved or installed */
  | 'install'
  /** Nothing recognisable */
  | 'unknown'

/** A classified failure with the evidence behind it. */
export interface ClassifiedFailure {
  kind: FailureKind
  /** Whether buddy-bot can fix this without a model */
  mechanical: boolean
  /** The lines that led to this classification */
  evidence: string[]
}

interface Signature {
  kind: FailureKind
  mechanical: boolean
  patterns: RegExp[]
}

/**
 * Failure signatures, most specific first.
 *
 * Ordering matters: a lockfile-drift failure also prints install noise, and
 * misreading it as a generic install failure would send it to the model
 * instead of the one-command fix.
 */
const SIGNATURES: Signature[] = [
  {
    kind: 'lockfile-drift',
    mechanical: true,
    patterns: [
      /lockfile had changes, but lockfile is frozen/i,
      /your lockfile does not satisfy your workspace/i,
      /the lockfile (?:is|was) out of date/i,
      /npm ci can only install packages when your package\.json and package-lock\.json .* are in sync/i,
      /composer\.lock is not up to date/i,
    ],
  },
  {
    kind: 'flake',
    mechanical: true,
    patterns: [
      /\bECONNRESET\b|\bETIMEDOUT\b|\bENOTFOUND\b|\bEAI_AGAIN\b/,
      /socket hang up/i,
      /502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out/i,
      /rate limit exceeded/i,
      /the runner has received a shutdown signal/i,
    ],
  },
  {
    kind: 'install',
    mechanical: false,
    patterns: [
      /could not resolve (?:dependency|host)/i,
      /no matching version found for/i,
      /unable to resolve dependency tree/i,
      /peer dep(?:endency)? .* conflict/i,
    ],
  },
  {
    kind: 'type-error',
    mechanical: false,
    patterns: [
      /error TS\d{4}:/,
      /\berror\[E\d+\]:/,
      /Type '.*' is not assignable to type/,
    ],
  },
  {
    kind: 'test-failure',
    mechanical: false,
    patterns: [
      /\d+ (?:tests? )?fail(?:ed|ing)\b/i,
      /\(fail\)/,
      /AssertionError|expect\(received\)/,
      /● .* › /,
    ],
  },
  {
    kind: 'lint',
    mechanical: false,
    patterns: [
      /\b\d+ problems? \(\d+ errors?/i,
      /eslint|pickier|biome|oxlint/i,
    ],
  },
]

/**
 * Classify a CI failure from its log.
 *
 * Classification runs before any model call so the failures with a known
 * mechanical fix — a stale lock file, a network blip — never spend tokens at
 * all. That is also what lets fix-ci deliver value with no AI configured.
 *
 * @param log - Captured job log
 * @returns The failure kind, whether it is mechanically fixable, and evidence
 * @example
 * ```ts
 * const failure = classifyFailure(log)
 * if (failure.mechanical)
 *   await regenerateLockfile()
 * ```
 */
export function classifyFailure(log: string): ClassifiedFailure {
  if (!log.trim())
    return { kind: 'unknown', mechanical: false, evidence: [] }

  const lines = log.split('\n')

  for (const signature of SIGNATURES) {
    const evidence: string[] = []

    for (const line of lines) {
      if (signature.patterns.some(pattern => pattern.test(line))) {
        evidence.push(line.trim())
        if (evidence.length >= 5)
          break
      }
    }

    if (evidence.length > 0)
      return { kind: signature.kind, mechanical: signature.mechanical, evidence }
  }

  return { kind: 'unknown', mechanical: false, evidence: extractErrorLines(lines) }
}

/**
 * Pull the lines most likely to explain a failure.
 *
 * Logs are mostly setup noise, so an unclassified failure still hands the
 * model the error lines rather than tens of thousands of tokens of output.
 *
 * @param lines - Log lines
 * @param limit - Maximum lines to return
 */
export function extractErrorLines(lines: string[], limit = 40): string[] {
  const interesting = lines.filter(line =>
    /\b(?:error|failed|failure|exception|panic|fatal)\b/i.test(line)
    && !/^\s*(?:at\s|\s*\.\.\.)/.test(line),
  )

  return (interesting.length > 0 ? interesting : lines.slice(-limit))
    .slice(-limit)
    .map(line => line.trim())
    .filter(Boolean)
}

/** A short human-readable description of a classified failure. */
export function describeFailure(failure: ClassifiedFailure): string {
  switch (failure.kind) {
    case 'lockfile-drift':
      return 'The lock file is out of step with its manifest.'
    case 'flake':
      return 'A network or runner problem, unrelated to the change.'
    case 'install':
      return 'Dependencies could not be resolved.'
    case 'type-error':
      return 'The change does not type-check.'
    case 'test-failure':
      return 'One or more tests failed.'
    case 'lint':
      return 'Lint or formatting checks failed.'
    default:
      return 'The failure could not be classified automatically.'
  }
}
