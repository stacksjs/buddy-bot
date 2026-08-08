/* eslint-disable no-console */
import process from 'node:process'
import { formatError } from './errors'

/**
 * Verbosity levels, ordered from quietest to loudest.
 *
 * `silent` is what programmatic consumers want: embedding buddy-bot in another
 * tool should not print several hundred lines to that tool's stdout.
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug'

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
}

/**
 * Replace `Error` arguments with their formatted message.
 *
 * Handing a raw `Error` to `console.*` makes Bun print a source-mapped code
 * frame. For the bundled CLI that frame is a line of minified `dist` output,
 * which floods CI logs and hides the actual failure. Non-Error arguments are
 * passed through untouched so object inspection still works.
 */
function redactErrorArgs(args: any[]): any[] {
  return args.map(arg => (arg instanceof Error ? formatError(arg) : arg))
}

/** Resolve the level implied by `BUDDY_BOT_LOG_LEVEL`, when set and valid. */
function levelFromEnv(): LogLevel | undefined {
  const raw = process.env.BUDDY_BOT_LOG_LEVEL?.toLowerCase()
  return raw && raw in LEVEL_ORDER ? raw as LogLevel : undefined
}

/**
 * Level-aware logger used throughout buddy-bot.
 *
 * Every message goes through an instance so output can be turned down or off.
 * Previously `info`, `warn`, `error` and `success` all wrote unconditionally
 * and only `debug` respected verbosity, which meant `verbose: false` did
 * almost nothing and library consumers could not silence the tool at all.
 *
 * @example
 * ```ts
 * const logger = new Logger(config.verbose)   // 'debug' when verbose, else 'info'
 * const quiet = Logger.silent()               // suppresses everything
 * const custom = Logger.withLevel('warn')     // warnings and errors only
 * ```
 */
export class Logger {
  private readonly level: LogLevel

  /**
   * @param verbose - Convenience flag: `true` selects `debug`, `false` selects `info`
   * @param level - Explicit level, overriding `verbose` when provided
   */
  constructor(verbose: boolean = false, level?: LogLevel) {
    this.level = level ?? levelFromEnv() ?? (verbose ? 'debug' : 'info')
  }

  /** Whether a message at `level` should be emitted. */
  private enabled(level: Exclude<LogLevel, 'silent'>): boolean {
    return LEVEL_ORDER[this.level] >= LEVEL_ORDER[level]
  }

  /**
   * Log an informational message.
   */
  info(message: string, ...args: any[]): void {
    if (this.enabled('info'))
      console.log(message, ...redactErrorArgs(args))
  }

  /**
   * Log a warning.
   */
  warn(message: string, ...args: any[]): void {
    if (this.enabled('warn'))
      console.warn(message, ...redactErrorArgs(args))
  }

  /**
   * Log an error.
   */
  error(message: string, ...args: any[]): void {
    if (this.enabled('error'))
      console.error(message, ...redactErrorArgs(args))
  }

  /**
   * Log a debug message in gray. Only emitted at the `debug` level.
   */
  debug(message: string, ...args: any[]): void {
    if (this.enabled('debug'))
      console.log(`\x1B[90m🐛\x1B[0m ${message}`, ...redactErrorArgs(args))
  }

  /**
   * Log a success message in green.
   */
  success(message: string, ...args: any[]): void {
    if (this.enabled('info'))
      console.log(`\x1B[32m✓\x1B[0m ${message}`, ...redactErrorArgs(args))
  }

  /** The level this logger emits at. */
  get logLevel(): LogLevel {
    return this.level
  }

  /**
   * Create a logger with verbose (debug) output enabled.
   */
  static verbose(): Logger {
    return new Logger(true, 'debug')
  }

  /**
   * Create a logger at the default `info` level.
   */
  static quiet(): Logger {
    return new Logger(false, 'info')
  }

  /**
   * Create a logger that emits nothing. Use when embedding buddy-bot in
   * another tool that owns its own output.
   */
  static silent(): Logger {
    return new Logger(false, 'silent')
  }

  /**
   * Create a logger at an explicit level.
   *
   * @param level - Level to emit at
   */
  static withLevel(level: LogLevel): Logger {
    return new Logger(false, level)
  }
}

/**
 * Process-wide logger for module-level functions that have no instance to
 * carry one — dependency-file parsers, the lock-file helper, and similar.
 *
 * Configure it once at startup with {@link setDefaultLogger}; class-based
 * consumers should keep taking a `Logger` in their constructor instead.
 */
let defaultLogger = new Logger(false)

/**
 * Replace the process-wide default logger.
 *
 * @param logger - Logger that free functions should use
 */
export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger
}

/**
 * The current process-wide default logger.
 */
export function getDefaultLogger(): Logger {
  return defaultLogger
}
