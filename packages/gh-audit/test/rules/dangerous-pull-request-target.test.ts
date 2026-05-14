import { describe, expect, it } from 'bun:test'
import { parseWorkflow } from '../../src/parser'
import { dangerousPullRequestTarget } from '../../src/rules/dangerous-pull-request-target'

function check(yaml: string) {
  const wf = parseWorkflow('test.yml', yaml)!
  return dangerousPullRequestTarget.check(wf)
}

describe('dangerous-pull-request-target rule', () => {
  it('passes a normal pull_request workflow', () => {
    const f = check(`name: t\non: pull_request\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`)
    expect(f).toEqual([])
  })

  it('flags pull_request_target + checkout of head sha', () => {
    const f = check(`name: t\non: pull_request_target\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`)
    expect(f.length).toBe(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].ruleId).toBe('dangerous-pull-request-target')
  })

  it('flags pull_request_target + checkout of github.head_ref', () => {
    const f = check(`name: t\non: pull_request_target\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.head_ref }}\n`)
    expect(f.length).toBe(1)
  })

  it('passes pull_request_target without explicit ref', () => {
    // Default ref under pull_request_target is the base — safe.
    const f = check(`name: t\non: pull_request_target\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n`)
    expect(f).toEqual([])
  })

  it('handles list of triggers', () => {
    const f = check(`name: t\non: [push, pull_request_target]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`)
    expect(f.length).toBe(1)
  })
})
