/* eslint-disable no-console */
import { formatError } from './errors'

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

export class Logger {
  constructor(private readonly verbose: boolean = false) {}

  /**
   * Log info message in blue
   */
  info(message: string, ...args: any[]): void {
    console.log(message, ...redactErrorArgs(args))
  }

  /**
   * Log warning message in yellow
   */
  warn(message: string, ...args: any[]): void {
    console.warn(message, ...redactErrorArgs(args))
  }

  /**
   * Log error message in red
   */
  error(message: string, ...args: any[]): void {
    console.error(message, ...redactErrorArgs(args))
  }

  /**
   * Log debug message in gray (only if verbose)
   */
  debug(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.log(`\x1B[90m🐛\x1B[0m ${message}`, ...redactErrorArgs(args))
    }
  }

  /**
   * Log success message in green
   */
  success(message: string, ...args: any[]): void {
    console.log(`\x1B[32m✓\x1B[0m ${message}`, ...redactErrorArgs(args))
  }

  /**
   * Create a logger with verbose mode enabled
   */
  static verbose(): Logger {
    return new Logger(true)
  }

  /**
   * Create a logger with verbose mode disabled
   */
  static quiet(): Logger {
    return new Logger(false)
  }
}
