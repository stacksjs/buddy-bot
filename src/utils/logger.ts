export class Logger {
  constructor(private readonly verbose: boolean = false) {}

  /**
   * Log info message in blue
   */
  info(message: string, ...args: any[]): void {
    console.log(`\x1b[34mℹ\x1b[0m ${message}`, ...args)
  }

  /**
   * Log warning message in yellow
   */
  warn(message: string, ...args: any[]): void {
    console.warn(`\x1b[33m⚠\x1b[0m ${message}`, ...args)
  }

  /**
   * Log error message in red
   */
  error(message: string, ...args: any[]): void {
    console.error(`\x1b[31m✖\x1b[0m ${message}`, ...args)
  }

  /**
   * Log debug message in gray (only if verbose)
   */
  debug(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.log(`\x1b[90m🐛\x1b[0m ${message}`, ...args)
    }
  }

  /**
   * Log success message in green
   */
  success(message: string, ...args: any[]): void {
    console.log(`\x1b[32m✓\x1b[0m ${message}`, ...args)
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
