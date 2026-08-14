import type { AgentMode } from './types'
import { implementMode, reviewMode } from './modes'

/** Where a finishing touch puts its result. */
export type TouchOutput = 'commit' | 'stacked-pr' | 'suggestion'

/** A named, repeatable agent task. */
export interface FinishingTouch {
  name: string
  /** One-line description, used in the offer comment */
  description: string
  /** Mode supplying the playbook and capability tiers */
  mode: AgentMode
  /** Default destination for the result */
  defaultOutput: TouchOutput
  /** Build the task text for a specific pull request */
  buildTask: (context: { summary?: string, files?: string[] }) => string
}

/** Shared framing for tasks that change code. */
const VERIFY = `Verify your work before reporting it done: run the project's
tests or build if one exists. If verification fails, report what failed rather
than claiming success — a change that looks right and breaks the build costs
more than no change at all.`

/** Generate missing documentation comments for changed public APIs. */
export const docstringsTouch: FinishingTouch = {
  name: 'docstrings',
  description: 'Add missing doc comments to changed public APIs',
  mode: implementMode,
  defaultOutput: 'commit',
  buildTask: ({ files }) => [
    'Add missing documentation comments to the public APIs changed on this branch.',
    '',
    'Follow the documentation style already used in the surrounding code — match its',
    'density and conventions rather than importing a different house style.',
    'Document what a caller needs: parameters, return value, thrown errors, and any',
    'constraint the signature does not already show. Do not restate what the code says.',
    '',
    'Do not document code that was not changed, and do not modify behaviour.',
    files?.length ? `\nChanged files:\n${files.map(file => `- ${file}`).join('\n')}` : '',
  ].filter(Boolean).join('\n'),
}

/** Generate tests for changed behaviour, verified by running them. */
export const unitTestsTouch: FinishingTouch = {
  name: 'unit-tests',
  description: 'Write tests covering the changed behaviour',
  mode: implementMode,
  defaultOutput: 'stacked-pr',
  buildTask: ({ files }) => [
    'Write tests covering the behaviour changed on this branch.',
    '',
    'Follow the existing test suite\'s structure and naming. Cover the success path,',
    'the failure path, and any edge case the change introduces.',
    '',
    'Run the tests you write. A generated test that does not pass is worse than none,',
    'so if you cannot make one pass, report why instead of committing it.',
    '',
    VERIFY,
    files?.length ? `\nChanged files:\n${files.map(file => `- ${file}`).join('\n')}` : '',
  ].filter(Boolean).join('\n'),
}

/** Apply the mechanical fixes a review already identified. */
export const autofixTouch: FinishingTouch = {
  name: 'autofix',
  description: 'Apply the committable suggestions from the review',
  mode: implementMode,
  defaultOutput: 'commit',
  buildTask: ({ summary }) => [
    'Apply the fixes identified by the review on this pull request.',
    '',
    'Apply only what the findings describe. Do not take the opportunity to refactor,',
    'rename, or tidy surrounding code — an autofix commit that also does unrelated',
    'work is one a reviewer has to disentangle.',
    '',
    VERIFY,
    summary ? `\nFindings:\n${summary}` : '',
  ].filter(Boolean).join('\n'),
}

/** Simplify changed code without altering behaviour. */
export const simplifyTouch: FinishingTouch = {
  name: 'simplify',
  description: 'Simplify the changed code without altering behaviour',
  mode: implementMode,
  defaultOutput: 'suggestion',
  buildTask: ({ files }) => [
    'Simplify the code changed on this branch without altering its behaviour.',
    '',
    'Look for duplicated logic, unnecessary indirection, and conditions that can be',
    'expressed more directly. Leave the code recognisable to whoever wrote it.',
    '',
    'Behaviour must not change. If a simplification would alter an edge case, leave it',
    'and say so.',
    '',
    VERIFY,
    files?.length ? `\nChanged files:\n${files.map(file => `- ${file}`).join('\n')}` : '',
  ].filter(Boolean).join('\n'),
}

/** Produce an implementation plan without changing anything. */
export const planTouch: FinishingTouch = {
  name: 'plan',
  description: 'Produce an implementation plan',
  mode: reviewMode,
  defaultOutput: 'suggestion',
  buildTask: ({ summary }) => [
    'Produce an implementation plan for the request below.',
    '',
    'Name the files that would change and why, the order of the work, the risks, and',
    'how the result would be verified. Write it so another agent could execute it',
    'without re-deriving your reasoning.',
    '',
    'Do not change anything — this is a plan, not an implementation.',
    summary ? `\nRequest:\n${summary}` : '',
  ].filter(Boolean).join('\n'),
}

/** Every built-in finishing touch, by name. */
export const FINISHING_TOUCHES: Record<string, FinishingTouch> = {
  'docstrings': docstringsTouch,
  'unit-tests': unitTestsTouch,
  'autofix': autofixTouch,
  'simplify': simplifyTouch,
  'plan': planTouch,
}

/**
 * Look up a finishing touch by name.
 *
 * @param name - Touch name
 * @throws {Error} When the name is unknown, rather than silently doing nothing
 */
export function getFinishingTouch(name: string): FinishingTouch {
  const touch = FINISHING_TOUCHES[name]
  if (!touch) {
    throw new Error(
      `Unknown finishing touch: ${name}. Available: ${Object.keys(FINISHING_TOUCHES).join(', ')}`,
    )
  }

  return touch
}

/**
 * Render the offer of available touches as checkbox markers.
 *
 * Uses the same marker-and-checkbox mechanism as the dashboard, so ticking one
 * is handled by machinery that already exists.
 *
 * @param names - Touches to offer
 */
export function renderTouchOffer(names: string[] = Object.keys(FINISHING_TOUCHES)): string {
  const lines = names
    .map(name => FINISHING_TOUCHES[name])
    .filter(Boolean)
    .map(touch => ` - [ ] <!-- buddy-bot:touch=${touch.name} -->${touch.description}`)

  if (lines.length === 0)
    return ''

  return `<details><summary>Finishing touches</summary>\n\nTick one to have it run:\n\n${lines.join('\n')}\n\n</details>`
}

/** Parse which touches a maintainer ticked. */
export function parseTouchSelections(body: string | null | undefined): string[] {
  if (!body)
    return []

  const selected: string[] = []
  const pattern = /^\s*-\s*\[[xX]\]\s*<!--\s*buddy-bot:touch=([\w-]+)\s*-->/gm

  for (const match of body.matchAll(pattern)) {
    if (FINISHING_TOUCHES[match[1]] && !selected.includes(match[1]))
      selected.push(match[1])
  }

  return selected
}
