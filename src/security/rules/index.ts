import type { Rule } from '../types'
import { bashInjection } from './bash-injection'
import { dangerousPullRequestTarget } from './dangerous-pull-request-target'
import { excessivePermissions } from './excessive-permissions'
import { missingTimeout } from './missing-timeout'
import { selfHostedExposure } from './self-hosted-exposure'
import { unpinnedAction } from './unpinned-action'

export const rules: Rule[] = [
  unpinnedAction,
  excessivePermissions,
  dangerousPullRequestTarget,
  bashInjection,
  missingTimeout,
  selfHostedExposure,
]

export {
  bashInjection,
  dangerousPullRequestTarget,
  excessivePermissions,
  missingTimeout,
  selfHostedExposure,
  unpinnedAction,
}
