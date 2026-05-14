import { describe, expect, it } from 'bun:test'
import { parseWorkflow } from '../../src/parser'
import { unpinnedAction } from '../../src/rules/unpinned-action'

function check(yaml: string) {
  const wf = parseWorkflow('test.yml', yaml)!
  return unpinnedAction.check(wf)
}

describe('unpinned-action rule', () => {
  it('exempts actions/* org', () => {
    const findings = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n`)
    expect(findings).toEqual([])
  })

  it('exempts github/* org', () => {
    const findings = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: github/codeql-action/init@v3\n`)
    expect(findings).toEqual([])
  })

  it('flags third-party actions on a tag', () => {
    const findings = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: oven-sh/setup-bun@v2\n`)
    expect(findings.length).toBe(1)
    expect(findings[0].ruleId).toBe('unpinned-action')
    expect(findings[0].message).toContain('oven-sh/setup-bun@v2')
  })

  it('passes third-party actions on a SHA', () => {
    const findings = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: oven-sh/setup-bun@4ea1b2cd0e8e8b7f6a5e3c8a9d4f6b0e1c3a8f0e\n`)
    expect(findings).toEqual([])
  })

  it('flags missing version reference', () => {
    const findings = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: oven-sh/setup-bun\n`)
    expect(findings.length).toBe(1)
    expect(findings[0].message).toContain('missing a version reference')
  })

  it('skips local action references', () => {
    const findings = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/local\n`)
    expect(findings).toEqual([])
  })

  it('skips docker:// references', () => {
    const findings = check(`name: t\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker://alpine:3.18\n`)
    expect(findings).toEqual([])
  })
})
