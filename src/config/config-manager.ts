import type { BuddyBotConfig } from '../types'
import process from 'node:process'

export class ConfigManager {
  /**
   * Default configuration
   */
  static readonly defaultConfig: BuddyBotConfig = {
    verbose: false,
  }

  /**
   * Load configuration from file (will use bunfig integration later)
   */
  static async loadConfig(_cwd: string = process.cwd()): Promise<BuddyBotConfig> {
    try {
      // For now, use the external config file approach
      // Will integrate with bunfig properly in next iteration
      return this.defaultConfig
    }
    catch (error) {
      console.warn('Failed to load config, using defaults:', error)
      return this.defaultConfig
    }
  }

  /**
   * Validate configuration
   */
  static validateConfig(config: BuddyBotConfig): boolean {
    return typeof config === 'object' && config !== null
  }
}
