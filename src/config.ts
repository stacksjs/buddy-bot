import type { BuddyBotConfig } from './types'
import { loadConfig } from 'bunfig'
import process from 'node:process'

export const defaultConfig: BuddyBotConfig = {
  verbose: true,
}

// eslint-disable-next-line antfu/no-top-level-await
export const config: BuddyBotConfig = await loadConfig({
  name: 'buddy-bot',
  cwd: process.cwd(),
  defaultConfig,
})
