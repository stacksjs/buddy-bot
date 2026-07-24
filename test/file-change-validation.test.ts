import type { FileChange } from '../src/types'
import { describe, expect, it } from 'bun:test'
import {
  assertUpdateTargetsExist,
  FileChangeValidationError,
  normalizeRepositoryPath,
} from '../src/utils/file-changes'

describe('file change validation', () => {
  it('normalizes repository-relative paths', () => {
    expect(normalizeRepositoryPath('./packages\\app/package.json')).toBe('packages/app/package.json')
  })

  it('rejects paths outside the repository', () => {
    expect(() => normalizeRepositoryPath('../package.json')).toThrow(FileChangeValidationError)
    expect(() => normalizeRepositoryPath('/tmp/package.json')).toThrow(FileChangeValidationError)
  })

  it('allows updates only when the base target exists', async () => {
    const files: FileChange[] = [
      { path: 'package.json', content: '{}', type: 'update' },
      { path: 'generated.json', content: '{}', type: 'create' },
    ]

    await expect(assertUpdateTargetsExist(files, path => path === 'package.json')).resolves.toBeUndefined()
  })

  it('rejects an update that would create a missing file', async () => {
    const files: FileChange[] = [{
      path: './pantry/install/cache/acorn/package.json',
      content: '{}',
      type: 'update',
    }]

    await expect(assertUpdateTargetsExist(files, () => false)).rejects.toThrow(
      'Refusing to create missing update target: pantry/install/cache/acorn/package.json',
    )
  })
})
