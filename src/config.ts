import type { BuddyBotConfig } from './types'
import { resolve } from 'node:path'
import { loadConfig } from 'bunfig'

export const defaultConfig: BuddyBotConfig = {
  verbose: true,
}

// eslint-disable-next-line antfu/no-top-level-await
export const config: BuddyBotConfig = await loadConfig({
  name: 'buddy-bot',
  cwd: resolve(__dirname, '..'),
  defaultConfig,
})
