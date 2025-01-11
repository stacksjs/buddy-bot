import type { StacksConfig } from '@stacksjs/types'
import { loadConfig } from 'bunfig'

export const defaultConfig: StacksConfig = {}

// eslint-disable-next-line antfu/no-top-level-await
export const config: StacksConfig = await loadConfig({
  name: 'stacks',
  defaultConfig,
})
