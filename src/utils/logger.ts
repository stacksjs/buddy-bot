/* eslint-disable no-console */
export class Logger {
  constructor(private readonly verbose: boolean = false) {}

  /**
   * Log info message in blue
   */
  info(message: string, ...args: any[]): void {
    console.log(message, ...args)
  }

  /**
   * Log warning message in yellow
   */
  warn(message: string, ...args: any[]): void {
    console.warn(`\x1B[33m⚠\x1B[0m ${message}`, ...args)
  }

  /**
   * Log error message in red
   */
  error(message: string, ...args: any[]): void {
    console.error(`\x1B[31m✖\x1B[0m ${message}`, ...args)
  }

  /**
   * Log debug message in gray (only if verbose)
   */
  debug(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.log(`\x1B[90m🐛\x1B[0m ${message}`, ...args)
    }
  }

  /**
   * Log success message in green
   */
  success(message: string, ...args: any[]): void {
    console.log(`\x1B[32m✓\x1B[0m ${message}`, ...args)
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
