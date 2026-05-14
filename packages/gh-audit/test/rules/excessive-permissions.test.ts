import { describe, expect, it } from 'bun:test'
import { parseWorkflow } from '../../src/parser'
import { excessivePermissions } from '../../src/rules/excessive-permissions'

function check(yaml: string) {
  const wf = parseWorkflow('test.yml', yaml)!
  return excessivePermissions.check(wf)
}

describe('excessive-permissions rule', () => {
  it('flags missing top-level permissions', () => {
    const f = check(`name: t\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: echo hi\n`)
    expect(f.some(x => x.message.includes('does not declare top-level'))).toBe(true)
  })

  it('flags write-all at workflow level as error', () => {
    const f = check(`name: t\non: push\npermissions: write-all\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`)
    const wa = f.find(x => x.message.includes('write-all'))
    expect(wa).toBeDefined()
    expect(wa!.severity).toBe('error')
  })

  it('flags write-all at job level as error', () => {
    const f = check(`name: t\non: push\npermissions:\n  contents: read\njobs:\n  b:\n    runs-on: ubuntu-latest\n    permissions: write-all\n    steps:\n      - run: echo hi\n`)
    const wa = f.find(x => x.severity === 'error' && x.message.includes('write-all'))
    expect(wa).toBeDefined()
  })

  it('flags id-token: write at workflow level', () => {
    const f = check(`name: t\non: push\npermissions:\n  id-token: write\njobs:\n  b:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: echo hi\n`)
    expect(f.some(x => x.message.includes('id-token: write'))).toBe(true)
  })

  it('passes a least-privilege block', () => {
    const f = check(`name: t\non: push\npermissions:\n  contents: read\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`)
    expect(f).toEqual([])
  })
})
