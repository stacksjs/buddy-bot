import { describe, expect, it } from 'bun:test'
import { parseWorkflow } from '../../src/parser'
import { bashInjection } from '../../src/rules/bash-injection'

function check(yaml: string) {
  const wf = parseWorkflow('test.yml', yaml)!
  return bashInjection.check(wf)
}

describe('bash-injection rule', () => {
  it('flags github.event.pull_request.title', () => {
    const f = check(`name: t\non: pull_request\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "\${{ github.event.pull_request.title }}"\n`)
    expect(f.length).toBe(1)
    expect(f[0].severity).toBe('error')
    expect(f[0].ruleId).toBe('bash-injection')
  })

  it('flags github.head_ref', () => {
    const f = check(`name: t\non: pull_request_target\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: git checkout \${{ github.head_ref }}\n`)
    expect(f.length).toBe(1)
  })

  it('passes secrets.* references', () => {
    const f = check(`name: t\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "\${{ secrets.MY_TOKEN }}"\n`)
    expect(f).toEqual([])
  })

  it('passes runner.* and env.* references', () => {
    const f = check(`name: t\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - env:\n          FOO: bar\n        run: echo \${{ runner.os }} \${{ env.FOO }}\n`)
    expect(f).toEqual([])
  })

  it('passes safe github.* fields like github.sha', () => {
    const f = check(`name: t\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \${{ github.sha }} \${{ github.repository }}\n`)
    expect(f).toEqual([])
  })

  it('flags multiple expressions in one run block', () => {
    const f = check(`name: t\non: pull_request\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          echo "\${{ github.event.pull_request.body }}"\n          echo "\${{ github.event.head_commit.message }}"\n`)
    expect(f.length).toBe(2)
  })
})
