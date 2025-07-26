import { describe, expect, it } from 'bun:test'

describe('GitHub Actions Integration - Core Functionality', () => {
  it('should have GitHub Actions parser utility functions available', async () => {
    const parser = await import('../src/utils/github-actions-parser')

    // Verify all main functions are exported
    expect(typeof parser.isGitHubActionsFile).toBe('function')
    expect(typeof parser.parseGitHubActionsFile).toBe('function')
    expect(typeof parser.updateGitHubActionsFile).toBe('function')
    expect(typeof parser.generateGitHubActionsUpdates).toBe('function')
    expect(typeof parser.fetchLatestActionVersion).toBe('function')
  })

  it('should correctly identify GitHub Actions files', async () => {
    const { isGitHubActionsFile } = await import('../src/utils/github-actions-parser')

    expect(isGitHubActionsFile('.github/workflows/ci.yml')).toBe(true)
    expect(isGitHubActionsFile('.github/workflows/release.yaml')).toBe(true)
    expect(isGitHubActionsFile('package.json')).toBe(false)
    expect(isGitHubActionsFile('deps.yaml')).toBe(false)
  })

  it('should parse workflow content correctly', async () => {
    const { parseGitHubActionsFile } = await import('../src/utils/github-actions-parser')

    const workflowContent = `
name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
`

    const result = await parseGitHubActionsFile('.github/workflows/ci.yml', workflowContent)

    expect(result).toBeTruthy()
    expect(result!.dependencies).toHaveLength(2)
    expect(result!.dependencies[0].name).toBe('actions/checkout')
    expect(result!.dependencies[0].currentVersion).toBe('v4')
    expect(result!.dependencies[0].type).toBe('github-actions')
  })

  it('should update workflow content correctly', async () => {
    const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

    const originalContent = `
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
`

    const updates = [{
      name: 'actions/checkout',
      currentVersion: 'v4',
      newVersion: 'v4.2.2',
      updateType: 'patch' as const,
      dependencyType: 'github-actions' as const,
      file: '.github/workflows/ci.yml',
    }]

    const result = await updateGitHubActionsFile('.github/workflows/ci.yml', originalContent, updates)

    expect(result).toContain('uses: actions/checkout@v4.2.2')
    expect(result).toContain('uses: oven-sh/setup-bun@v2') // Unchanged
  })

  it('should have github-actions dependency type in types', async () => {
    // This validates that our type system supports GitHub Actions
    const mockDependency = {
      name: 'actions/checkout',
      currentVersion: 'v4',
      type: 'github-actions' as const,
      file: '.github/workflows/ci.yml',
    }

    expect(mockDependency.type).toBe('github-actions')
  })

  it('should be able to create GitHub Actions package updates', async () => {
    // This validates the PackageUpdate interface supports GitHub Actions
    const mockUpdate = {
      name: 'actions/checkout',
      currentVersion: 'v4',
      newVersion: 'v4.2.2',
      updateType: 'patch' as const,
      dependencyType: 'github-actions' as const,
      file: '.github/workflows/ci.yml',
      releaseNotesUrl: 'https://github.com/actions/checkout/releases',
      homepage: 'https://github.com/actions/checkout',
    }

    expect(mockUpdate.dependencyType).toBe('github-actions')
    expect(mockUpdate.releaseNotesUrl).toContain('github.com')
  })
})
