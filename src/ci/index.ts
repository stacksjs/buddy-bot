export {
  classifyFailure,
  describeFailure,
  extractErrorLines,
} from './classify'
export type { ClassifiedFailure, FailureKind } from './classify'
export { attemptFix } from './fix'
export type { FixOptions, FixOutcome } from './fix'
