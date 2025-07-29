import type { BuddyBotConfig } from './types'
import process from 'node:process'
import { loadConfig } from 'bunfig'

export const defaultConfig: BuddyBotConfig = {
  verbose: true,
}

// eslint-disable-next-line antfu/no-top-level-await
export const config: BuddyBotConfig = await loadConfig({
  name: 'buddy-bot',
  cwd: process.cwd(),
  defaultConfig,
})
