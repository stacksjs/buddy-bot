import { describe, expect, it } from 'bun:test'
import { parseWorkflow } from '../../src/parser'
import { missingTimeout } from '../../src/rules/missing-timeout'

function check(yaml: string) {
  const wf = parseWorkflow('test.yml', yaml)!
  return missingTimeout.check(wf)
}

describe('missing-timeout rule', () => {
  it('flags a job without timeout-minutes', () => {
    const f = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`)
    expect(f.length).toBe(1)
    expect(f[0].ruleId).toBe('missing-timeout')
  })

  it('passes a job with timeout-minutes', () => {
    const f = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - run: echo hi\n`)
    expect(f).toEqual([])
  })

  it('flags zero timeout', () => {
    const f = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 0\n    steps:\n      - run: echo hi\n`)
    expect(f.length).toBe(1)
  })

  it('flags each job independently', () => {
    const f = check(`name: t\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{ run: echo a }]\n  b:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps: [{ run: echo b }]\n`)
    expect(f.length).toBe(1)
    expect(f[0].message).toContain('`a`')
  })
})
