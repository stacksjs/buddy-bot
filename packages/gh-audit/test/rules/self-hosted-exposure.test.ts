import { describe, expect, it } from 'bun:test'
import { parseWorkflow } from '../../src/parser'
import { selfHostedExposure } from '../../src/rules/self-hosted-exposure'

function check(yaml: string) {
  const wf = parseWorkflow('test.yml', yaml)!
  return selfHostedExposure.check(wf)
}

describe('self-hosted-exposure rule', () => {
  it('flags bare runs-on: self-hosted', () => {
    const f = check(`name: t\non: push\njobs:\n  b:\n    runs-on: self-hosted\n    steps: [{ run: echo hi }]\n`)
    expect(f.length).toBe(1)
    expect(f[0].ruleId).toBe('self-hosted-exposure')
  })

  it('flags runs-on: [self-hosted] without other labels', () => {
    const f = check(`name: t\non: push\njobs:\n  b:\n    runs-on: [self-hosted]\n    steps: [{ run: echo hi }]\n`)
    expect(f.length).toBe(1)
  })

  it('passes self-hosted with scoping label', () => {
    const f = check(`name: t\non: push\njobs:\n  b:\n    runs-on: [self-hosted, my-project]\n    steps: [{ run: echo hi }]\n`)
    expect(f).toEqual([])
  })

  it('passes hosted runners', () => {
    const f = check(`name: t\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps: [{ run: echo hi }]\n`)
    expect(f).toEqual([])
  })
})
