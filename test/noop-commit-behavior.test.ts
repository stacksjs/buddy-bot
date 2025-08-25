import { describe, expect, it } from 'bun:test'
import type { FileChange } from '../src/types'
import { GitHubProvider } from '../src/git/github-provider'

describe('No-op commit prevention', () => {
  const filesChanged: FileChange[] = [
    { path: 'package.json', content: '{"name":"x"}', type: 'update' },
  ]

  it('does not commit/push when git status has no changes (Git path)', async () => {
    const prov = new GitHubProvider('token', 'owner', 'repo', true) as any
    const commands: Array<{ cmd: string; args: string[] }> = []
    prov.runCommand = async (command: string, args: string[]) => {
      commands.push({ cmd: command, args })
      if (command === 'git' && args[0] === 'status' && args[1] === '--porcelain') return ''
      return ''
    }

    await prov.commitChanges('buddy/test-branch', 'test message', filesChanged)

    const cmds = commands.map(c => c.args.join(' ')).join('\n')
    expect(cmds).toContain('status --porcelain')
    expect(cmds).not.toContain('commit -m')
    expect(cmds).not.toContain('push origin')
  })

  it('commits and pushes when git status shows changes (Git path)', async () => {
    const prov = new GitHubProvider('token', 'owner', 'repo', true) as any
    const commands: Array<{ cmd: string; args: string[] }> = []
    prov.runCommand = async (command: string, args: string[]) => {
      commands.push({ cmd: command, args })
      if (command === 'git' && args[0] === 'status' && args[1] === '--porcelain') return ' M package.json'
      return ''
    }

    await prov.commitChanges('buddy/test-branch', 'test message', filesChanged)

    const hasCommit = commands.some(c => c.args[0] === 'commit' && c.args[1] === '-m')
    const hasPush = commands.some(c => c.args[0] === 'push' && c.args[1] === 'origin')
    expect(hasCommit).toBeTrue()
    expect(hasPush).toBeTrue()
  })

  it('skips API commit when new tree equals current tree (API fallback path)', async () => {
    const prov = new GitHubProvider('token', 'owner', 'repo', true) as any
    const apiCalls: Array<{ endpoint: string; data: any }> = []
    // Force API path by making git fail
    prov.runCommand = async () => { throw new Error('simulated git failure') }
    prov.apiRequest = async (endpoint: string, data?: any) => {
      apiCalls.push({ endpoint, data })
      if (endpoint.startsWith('GET /repos/') && endpoint.includes('/git/ref/heads/')) return { object: { sha: 'sha-current' } }
      if (endpoint.startsWith('GET /repos/') && endpoint.includes('/git/commits/')) return { sha: 'sha-current', tree: { sha: 'tree-current' } }
      if (endpoint.startsWith('POST /repos/') && endpoint.includes('/git/trees')) {
        if (data && Array.isArray(data.tree) && data.tree.length === 0) return { sha: 'tree-current' }
        return { sha: 'tree-new' }
      }
      if (endpoint.startsWith('POST /repos/') && endpoint.includes('/git/blobs')) return { sha: 'blob-sha' }
      if (endpoint.startsWith('POST /repos/') && endpoint.includes('/git/commits')) return { sha: 'commit-new' }
      if (endpoint.startsWith('PATCH /repos/') && endpoint.includes('/git/refs/heads/')) return { object: { sha: 'sha-updated' } }
      return {}
    }

    // Use empty tree change (no files) to trigger same-tree behavior
    await prov.commitChanges('buddy/test-branch', 'test message', [])

    // Ensure we did NOT create commit nor update ref
    const createdCommit = apiCalls.some(c => c.endpoint.includes('/git/commits') && c.endpoint.startsWith('POST'))
    const updatedRef = apiCalls.some(c => c.endpoint.includes('/git/refs/heads/') && c.endpoint.startsWith('PATCH'))

    expect(createdCommit).toBeFalse()
    expect(updatedRef).toBeFalse()
  })
})
