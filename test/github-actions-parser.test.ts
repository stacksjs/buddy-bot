import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

// Mock fetch globally for testing
function mockFetch(response: any, ok = true, status = 200) {
  return spyOn(globalThis, 'fetch').mockImplementation((async () => ({
    ok,
    status,
    json: async () => response,
  })) as any)
}

describe('GitHub Actions Parser', () => {
  let readFileSpy: any
  let existsSyncSpy: any

  beforeEach(async () => {
    // Mock node:fs functions
    readFileSpy = spyOn(await import('node:fs'), 'readFileSync')
    existsSyncSpy = spyOn(await import('node:fs'), 'existsSync')
  })

  afterEach(() => {
    readFileSpy?.mockRestore()
    existsSyncSpy?.mockRestore()
  })

  describe('isGitHubActionsFile', () => {
    it('should identify GitHub Actions workflow files correctly', async () => {
      const { isGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      expect(isGitHubActionsFile('.github/workflows/ci.yml')).toBe(true)
      expect(isGitHubActionsFile('.github/workflows/release.yaml')).toBe(true)
      expect(isGitHubActionsFile('.github/workflows/test.yml')).toBe(true)
      expect(isGitHubActionsFile('workflows/ci.yml')).toBe(false)
      expect(isGitHubActionsFile('package.json')).toBe(false)
      expect(isGitHubActionsFile('deps.yaml')).toBe(false)
      expect(isGitHubActionsFile('.github/dependabot.yml')).toBe(false)
    })

    it('should handle Windows-style paths', async () => {
      const { isGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      expect(isGitHubActionsFile('.github\\workflows\\ci.yml')).toBe(true)
      expect(isGitHubActionsFile('.github\\workflows\\release.yaml')).toBe(true)
    })
  })

  describe('parseGitHubActionsFile', () => {
    it('should parse GitHub Actions workflow file and extract dependencies', async () => {
      const { parseGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const workflowContent = `
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Install dependencies
        run: bun install
      - uses: actions/cache@v4.1.0
        with:
          path: ~/.bun
          key: \${{ runner.os }}-bun
`

      const result = await parseGitHubActionsFile('.github/workflows/ci.yml', workflowContent)

      expect(result).toBeTruthy()
      expect(result!.path).toBe('.github/workflows/ci.yml')
      expect(result!.dependencies).toHaveLength(3)

      const deps = result!.dependencies
      expect(deps[0]).toEqual({
        name: 'actions/checkout',
        currentVersion: 'v4',
        type: 'github-actions',
        file: '.github/workflows/ci.yml',
      })
      expect(deps[1]).toEqual({
        name: 'oven-sh/setup-bun',
        currentVersion: 'v2',
        type: 'github-actions',
        file: '.github/workflows/ci.yml',
      })
      expect(deps[2]).toEqual({
        name: 'actions/cache',
        currentVersion: 'v4.1.0',
        type: 'github-actions',
        file: '.github/workflows/ci.yml',
      })
    })

    it('should skip local actions and docker actions', async () => {
      const { parseGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const workflowContent = `
name: CI
jobs:
  test:
    steps:
      - uses: ./local-action
      - uses: docker://node:18
      - uses: actions/checkout@v4
`

      const result = await parseGitHubActionsFile('.github/workflows/ci.yml', workflowContent)

      expect(result!.dependencies).toHaveLength(1)
      expect(result!.dependencies[0].name).toBe('actions/checkout')
    })

    it('should handle various quote styles', async () => {
      const { parseGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const workflowContent = `
jobs:
  test:
    steps:
      - uses: "actions/checkout@v4"
      - uses: 'oven-sh/setup-bun@v2'
      - uses: actions/cache@v4.1.0
`

      const result = await parseGitHubActionsFile('.github/workflows/ci.yml', workflowContent)

      expect(result!.dependencies).toHaveLength(3)
      expect(result!.dependencies[0].name).toBe('actions/checkout')
      expect(result!.dependencies[1].name).toBe('oven-sh/setup-bun')
      expect(result!.dependencies[2].name).toBe('actions/cache')
    })

    it('should return null for non-GitHub Actions files', async () => {
      const { parseGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const result = await parseGitHubActionsFile('package.json', '{}')

      expect(result).toBeNull()
    })

    it('should handle malformed action references gracefully', async () => {
      const { parseGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const workflowContent = `
jobs:
  test:
    steps:
      - uses: invalid-action-without-version
      - uses: actions/checkout@v4
      - uses: @just-version
`

      const result = await parseGitHubActionsFile('.github/workflows/ci.yml', workflowContent)

      expect(result!.dependencies).toHaveLength(1)
      expect(result!.dependencies[0].name).toBe('actions/checkout')
    })
  })

  describe('updateGitHubActionsFile', () => {
    it('should update action versions in workflow file content', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const originalContent = `
name: CI
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Install
        run: bun install
      - uses: actions/cache@v4.1.0
`

      const updates = [
        {
          name: 'actions/checkout',
          currentVersion: 'v4',
          newVersion: 'v4.2.2',
          updateType: 'patch' as const,
          dependencyType: 'github-actions' as const,
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'oven-sh/setup-bun',
          currentVersion: 'v2',
          newVersion: 'v2.0.2',
          updateType: 'patch' as const,
          dependencyType: 'github-actions' as const,
          file: '.github/workflows/ci.yml',
        },
      ]

      const result = await updateGitHubActionsFile('.github/workflows/ci.yml', originalContent, updates)

      expect(result).toContain('uses: actions/checkout@v4.2.2')
      expect(result).toContain('uses: oven-sh/setup-bun@v2.0.2')
      expect(result).toContain('uses: actions/cache@v4.1.0') // Unchanged
      expect(result).toContain('run: bun install') // Other content preserved
    })

    it('should handle actions with special characters in names', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const originalContent = 'uses: crazy-max/ghaction-docker-buildx@v3.1.0'

      const updates = [{
        name: 'crazy-max/ghaction-docker-buildx',
        currentVersion: 'v3.1.0',
        newVersion: 'v3.2.0',
        updateType: 'minor' as const,
        dependencyType: 'github-actions' as const,
        file: '.github/workflows/ci.yml',
      }]

      const result = await updateGitHubActionsFile('.github/workflows/ci.yml', originalContent, updates)

      expect(result).toBe('uses: crazy-max/ghaction-docker-buildx@v3.2.0')
    })

    it('should return original content for non-GitHub Actions files', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const content = 'not a workflow file'
      const result = await updateGitHubActionsFile('package.json', content, [])

      expect(result).toBe(content)
    })
  })

  describe('generateGitHubActionsUpdates', () => {
    it('should generate file updates for GitHub Actions', async () => {
      const { generateGitHubActionsUpdates } = await import('../src/utils/github-actions-parser')

      const mockWorkflowContent = `
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
`

      existsSyncSpy.mockReturnValue(true)
      readFileSpy.mockReturnValue(mockWorkflowContent)

      const updates = [{
        name: 'actions/checkout',
        currentVersion: 'v4',
        newVersion: 'v4.2.2',
        updateType: 'patch' as const,
        dependencyType: 'github-actions' as const,
        file: '.github/workflows/ci.yml',
      }]

      const result = await generateGitHubActionsUpdates(updates)

      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('.github/workflows/ci.yml')
      expect(result[0].type).toBe('update')
      expect(result[0].content).toContain('uses: actions/checkout@v4.2.2')
    })

    it('should skip non-existent files', async () => {
      const { generateGitHubActionsUpdates } = await import('../src/utils/github-actions-parser')

      existsSyncSpy.mockReturnValue(false)

      const updates = [{
        name: 'actions/checkout',
        currentVersion: 'v4',
        newVersion: 'v4.2.2',
        updateType: 'patch' as const,
        dependencyType: 'github-actions' as const,
        file: '.github/workflows/nonexistent.yml',
      }]

      const result = await generateGitHubActionsUpdates(updates)

      expect(result).toHaveLength(0)
    })

    it('should filter to only GitHub Actions files', async () => {
      const { generateGitHubActionsUpdates } = await import('../src/utils/github-actions-parser')

      existsSyncSpy.mockReturnValue(false)

      const updates = [
        {
          name: 'actions/checkout',
          currentVersion: 'v4',
          newVersion: 'v4.2.2',
          updateType: 'patch' as const,
          dependencyType: 'github-actions' as const,
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'lodash',
          currentVersion: '4.17.0',
          newVersion: '4.17.21',
          updateType: 'patch' as const,
          dependencyType: 'dependencies' as const,
          file: 'package.json',
        },
      ]

      const result = await generateGitHubActionsUpdates(updates)

      expect(result).toHaveLength(0) // No files processed since existsSync returns false by default
    })
  })

  describe('fetchLatestActionVersion', () => {
    afterEach(() => {
      // Restore fetch mock after each test
      if ((globalThis.fetch as any).mockRestore) {
        (globalThis.fetch as any).mockRestore()
      }
    })

    it('should fetch latest version from GitHub API', async () => {
      const { fetchLatestActionVersion } = await import('../src/utils/github-actions-parser')

      const mockResponse = { tag_name: 'v4.2.2' }
      mockFetch(mockResponse)

      const result = await fetchLatestActionVersion('actions/checkout')

      expect(result).toBe('v4.2.2')
      expect(globalThis.fetch).toHaveBeenCalledWith('https://api.github.com/repos/actions/checkout/releases/latest', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'buddy-bot',
        },
      })
    })

    it('should return null for invalid action names', async () => {
      const { fetchLatestActionVersion } = await import('../src/utils/github-actions-parser')

      const result = await fetchLatestActionVersion('invalid-action')

      expect(result).toBeNull()
    })

    it('should return null for API errors', async () => {
      const { fetchLatestActionVersion } = await import('../src/utils/github-actions-parser')

      mockFetch({}, false, 404)

      const result = await fetchLatestActionVersion('actions/nonexistent')

      expect(result).toBeNull()
    })

    it('should handle missing tag_name in response', async () => {
      const { fetchLatestActionVersion } = await import('../src/utils/github-actions-parser')

      const mockResponse = { name: 'Latest Release' } // Missing tag_name
      mockFetch(mockResponse)

      const result = await fetchLatestActionVersion('actions/checkout')

      expect(result).toBeNull()
    })

    it('should handle network errors gracefully', async () => {
      const { fetchLatestActionVersion } = await import('../src/utils/github-actions-parser')

      spyOn(globalThis, 'fetch').mockImplementation((() => {
        throw new Error('Network error')
      }) as any)

      const result = await fetchLatestActionVersion('actions/checkout')

      expect(result).toBeNull()
    })

    it('should detect major version updates correctly', async () => {
      const { fetchLatestActionVersion } = await import('../src/utils/github-actions-parser')

      // Mock the latest release API to return v5 (major update from v4)
      const mockLatestResponse = { tag_name: 'v5' }
      const mockFetch = (spyOn(globalThis, 'fetch') as any).mockImplementation(async (url: string) => {
        if (url.includes('/releases/latest')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockLatestResponse,
          } as any
        }
        // For other API calls, return empty results
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as any
      })

      const result = await fetchLatestActionVersion('actions/download-artifact')

      expect(result).toBe('v5')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/actions/download-artifact/releases/latest', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'buddy-bot',
        },
      })
    })

    it('should fallback to all releases when latest release fails', async () => {
      const { fetchLatestActionVersion } = await import('../src/utils/github-actions-parser')

      const mockReleases = [
        { tag_name: 'v5.0.0', published_at: '2024-01-15T00:00:00Z' },
        { tag_name: 'v4.1.0', published_at: '2024-01-10T00:00:00Z' },
        { tag_name: 'v4.0.0', published_at: '2024-01-05T00:00:00Z' },
      ]

      const mockFetch = (spyOn(globalThis, 'fetch') as any).mockImplementation(async (url: string) => {
        if (url.includes('/releases/latest')) {
          return {
            ok: false,
            status: 404,
            json: async () => ({}),
          } as any
        }
        if (url.includes('/releases?')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockReleases,
          } as any
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as any
      })

      const result = await fetchLatestActionVersion('actions/download-artifact')

      expect(result).toBe('v5.0.0')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/actions/download-artifact/releases?per_page=10', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'buddy-bot',
        },
      })
    })

    it('should fallback to tags when releases fail', async () => {
      const { fetchLatestActionVersion } = await import('../src/utils/github-actions-parser')

      const mockTags = [
        { name: 'v5.0.0' },
        { name: 'v4.1.0' },
        { name: 'v4.0.0' },
      ]

      const mockFetch = (spyOn(globalThis, 'fetch') as any).mockImplementation(async (url: string) => {
        if (url.includes('/releases/latest') || url.includes('/releases?')) {
          return {
            ok: false,
            status: 404,
            json: async () => ({}),
          } as any
        }
        if (url.includes('/tags?')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockTags,
          } as any
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as any
      })

      const result = await fetchLatestActionVersion('actions/download-artifact')

      expect(result).toBe('v5.0.0')
      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/repos/actions/download-artifact/tags?per_page=10', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'buddy-bot',
        },
      })
    })
  })
})
