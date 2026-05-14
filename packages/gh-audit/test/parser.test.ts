import { describe, expect, it } from 'bun:test'
import { findLine, parseWorkflow } from '../src/parser'

describe('parseWorkflow', () => {
  it('returns null for unparseable yaml', () => {
    expect(parseWorkflow('x.yml', '::: not yaml :::')).toBeNull()
  })

  it('returns null for non-object yaml', () => {
    expect(parseWorkflow('x.yml', '"just a string"')).toBeNull()
  })

  it('returns parsed workflow for valid yaml', () => {
    const out = parseWorkflow('ci.yml', 'name: test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n')
    expect(out).not.toBeNull()
    expect(out!.data.name).toBe('test')
    expect(out!.file).toBe('ci.yml')
  })
})

describe('findLine', () => {
  const raw = 'line one\nline two\nline three\n'

  it('finds a substring on line 1', () => {
    expect(findLine(raw, 'line one')).toBe(1)
  })

  it('finds a substring on a later line', () => {
    expect(findLine(raw, 'line three')).toBe(3)
  })

  it('returns undefined when the needle is missing', () => {
    expect(findLine(raw, 'absent')).toBeUndefined()
  })

  it('returns undefined for an empty needle', () => {
    expect(findLine(raw, '')).toBeUndefined()
  })
})
