import { describe, expect, it } from 'bun:test'
import { auditParsed } from '../src/engine'
import { parseWorkflow } from '../src/parser'

const goodYaml = `
name: clean
on: push
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - run: echo "\${{ secrets.TOKEN }}"
`

const badYaml = `
name: bad
on: pull_request_target
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: echo "\${{ github.event.pull_request.title }}"
`

describe('auditParsed', () => {
  it('returns no findings for a clean workflow', () => {
    const wf = parseWorkflow('clean.yml', goodYaml)!
    const r = auditParsed([wf])
    expect(r.failed).toBe(false)
    expect(r.findings).toEqual([])
  })

  it('flags errors for an unsafe workflow', () => {
    const wf = parseWorkflow('bad.yml', badYaml)!
    const r = auditParsed([wf])
    expect(r.failed).toBe(true)
    expect(r.findings.some(f => f.ruleId === 'dangerous-pull-request-target')).toBe(true)
    expect(r.findings.some(f => f.ruleId === 'bash-injection')).toBe(true)
  })

  it('respects the ignore option', () => {
    const wf = parseWorkflow('bad.yml', badYaml)!
    const r = auditParsed([wf], { ignore: ['dangerous-pull-request-target', 'bash-injection'] })
    expect(r.findings.some(f => f.ruleId === 'dangerous-pull-request-target')).toBe(false)
    expect(r.findings.some(f => f.ruleId === 'bash-injection')).toBe(false)
  })
})
