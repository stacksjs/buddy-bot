import type { BuddyBotConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buddy } from '../src/buddy'
import { checkForAutoClose } from '../src/utils/helpers'
import { Logger } from '../src/utils/logger'

describe('IgnorePaths Auto-Close Functionality', () => {
  let testDir: string
  let logger: Logger

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'buddy-ignore-paths-autoclose-'))
    process.chdir(testDir)
    logger = new Logger(false) // Quiet logger for tests
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('shouldAutoCloseForIgnorePaths', () => {
    it('should return false when no ignorePaths configured', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: { strategy: 'all' }, // No ignorePaths
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update dependencies',
        body: `
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/test-envs/package.json** | ✅ |
`,
        head: 'buddy-bot/update-test',
        author: 'github-actions[bot]',
      }

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoCloseForIgnorePaths(mockPR)
      expect(shouldClose).toBe(false)
    })

    it('should return false when PR contains no file paths', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['packages/test-envs/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update dependencies',
        body: 'This PR has no file paths mentioned',
        head: 'buddy-bot/update-test',
        author: 'github-actions[bot]',
      }

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoCloseForIgnorePaths(mockPR)
      expect(shouldClose).toBe(false)
    })

    it('should return true when PR contains files matching ignorePaths', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['packages/test-envs/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update dependencies',
        body: `
## Updates

| Package | Version | File | Status |
|---------|---------|------|--------|
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/test-envs/env1/package.json** | ✅ |
| [react](https://github.com/facebook/react) | \`^17.0.0\` → \`^18.0.0\` | **packages/test-envs/env2/package.json** | ✅ |
`,
        head: 'buddy-bot/update-test',
        author: 'github-actions[bot]',
      }

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoCloseForIgnorePaths(mockPR)
      expect(shouldClose).toBe(true)
    })

    it('should return false when PR contains files not matching ignorePaths', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['packages/test-envs/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update dependencies',
        body: `
## Updates

| Package | Version | File | Status |
|---------|---------|------|--------|
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/ui/package.json** | ✅ |
| [react](https://github.com/facebook/react) | \`^17.0.0\` → \`^18.0.0\` | **src/package.json** | ✅ |
`,
        head: 'buddy-bot/update-test',
        author: 'github-actions[bot]',
      }

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoCloseForIgnorePaths(mockPR)
      expect(shouldClose).toBe(false)
    })

    it('should handle multiple ignorePaths patterns', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['packages/test-*/**', '**/legacy/**', 'apps/old/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update dependencies',
        body: `
## Updates

| Package | Version | File | Status |
|---------|---------|------|--------|
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/test-utils/package.json** | ✅ |
| [react](https://github.com/facebook/react) | \`^17.0.0\` → \`^18.0.0\` | **src/legacy/package.json** | ✅ |
| [vue](https://github.com/vuejs/vue) | \`^2.0.0\` → \`^3.0.0\` | **apps/old/package.json** | ✅ |
`,
        head: 'buddy-bot/update-test',
        author: 'github-actions[bot]',
      }

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoCloseForIgnorePaths(mockPR)
      expect(shouldClose).toBe(true)
    })

    it('should handle mixed files (some matching, some not)', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['packages/test-envs/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update dependencies',
        body: `
## Updates

| Package | Version | File | Status |
|---------|---------|------|--------|
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/test-envs/package.json** | ✅ |
| [react](https://github.com/facebook/react) | \`^17.0.0\` → \`^18.0.0\` | **packages/ui/package.json** | ✅ |
`,
        head: 'buddy-bot/update-test',
        author: 'github-actions[bot]',
      }

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoCloseForIgnorePaths(mockPR)
      expect(shouldClose).toBe(true) // Should close if ANY file matches
    })
  })

  describe('extractFilePathsFromPRBody', () => {
    it('should extract file paths from table format with bold file names', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: { strategy: 'all' },
      }

      const buddy = new Buddy(config, testDir)

      const prBody = `
## Updates

| Package | Version | File | Status |
|---------|---------|------|--------|
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/test-envs/package.json** | ✅ |
| [react](https://github.com/facebook/react) | \`^17.0.0\` → \`^18.0.0\` | **src/package.json** | ✅ |
`

      // @ts-expect-error - accessing private method for testing
      const filePaths = buddy.extractFilePathsFromPRBody(prBody)
      expect(filePaths).toContain('packages/test-envs/package.json')
      expect(filePaths).toContain('src/package.json')
      expect(filePaths.length).toBeGreaterThanOrEqual(2)
    })

    it('should extract file paths from simple table format', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: { strategy: 'all' },
      }

      const buddy = new Buddy(config, testDir)

      const prBody = `
| lodash | ^4.0.0 → ^4.17.21 | packages/test-envs/package.json | ✅ |
| react | ^17.0.0 → ^18.0.0 | composer.json | ✅ |
`

      // @ts-expect-error - accessing private method for testing
      const filePaths = buddy.extractFilePathsFromPRBody(prBody)
      expect(filePaths).toEqual([
        'packages/test-envs/package.json',
        'composer.json',
      ])
    })

    it('should extract file paths from text mentions', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: { strategy: 'all' },
      }

      const buddy = new Buddy(config, testDir)

      const prBody = `
This PR updates dependencies in packages/launchpad/test-envs/env1/package.json and
also modifies apps/legacy/deps.yaml for better compatibility.
`

      // @ts-expect-error - accessing private method for testing
      const filePaths = buddy.extractFilePathsFromPRBody(prBody)
      expect(filePaths).toEqual([
        'packages/launchpad/test-envs/env1/package.json',
        'apps/legacy/deps.yaml',
      ])
    })

    it('should handle empty or malformed PR bodies', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: { strategy: 'all' },
      }

      const buddy = new Buddy(config, testDir)

      // @ts-expect-error - accessing private method for testing
      expect(buddy.extractFilePathsFromPRBody('')).toEqual([])
      // @ts-expect-error - accessing private method for testing
      expect(buddy.extractFilePathsFromPRBody('No file paths here')).toEqual([])
      // @ts-expect-error - accessing private method for testing
      expect(buddy.extractFilePathsFromPRBody('| invalid | table | format |')).toEqual([])
    })
  })

  describe('checkForAutoClose helper function', () => {
    it('should return true for ignorePaths auto-close', async () => {
      const config = {
        packages: {
          respectLatest: false, // Disable respectLatest to test ignorePaths only
          ignorePaths: ['packages/test-envs/**'],
        },
      }

      const mockPR = {
        number: 1,
        body: `
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/test-envs/package.json** | ✅ |
`,
      }

      const shouldClose = await checkForAutoClose(mockPR, config, logger)
      expect(shouldClose).toBe(true)
    })

    it('should return false when no ignorePaths match', async () => {
      const config = {
        packages: {
          respectLatest: false, // Disable respectLatest to test ignorePaths only
          ignorePaths: ['packages/test-envs/**'],
        },
      }

      const mockPR = {
        number: 1,
        body: `
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/ui/package.json** | ✅ |
`,
      }

      const shouldClose = await checkForAutoClose(mockPR, config, logger)
      expect(shouldClose).toBe(false)
    })

    it('should prioritize respectLatest over ignorePaths', async () => {
      const config = {
        packages: {
          respectLatest: true,
          ignorePaths: ['packages/ui/**'], // Different path than PR
        },
      }

      const mockPR = {
        number: 1,
        body: `
| [lodash](https://github.com/lodash/lodash) | \`*\` → \`^4.17.21\` | **packages/test-envs/package.json** | ✅ |
`,
      }

      const shouldClose = await checkForAutoClose(mockPR, config, logger)
      expect(shouldClose).toBe(true) // Should close due to respectLatest (dynamic version)
    })

    it('should handle both respectLatest and ignorePaths conditions', async () => {
      const config = {
        packages: {
          respectLatest: true,
          ignorePaths: ['packages/test-envs/**'],
        },
      }

      const mockPR = {
        number: 1,
        body: `
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/test-envs/package.json** | ✅ |
`,
      }

      const shouldClose = await checkForAutoClose(mockPR, config, logger)
      expect(shouldClose).toBe(true) // Should close due to ignorePaths
    })
  })

  describe('Integration with Buddy class', () => {
    it('should auto-close PRs when ignorePaths configuration changes', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['packages/launchpad/test-envs/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update test environment dependencies',
        body: `
## Updates

| Package | Version | File | Status |
|---------|---------|------|--------|
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/launchpad/test-envs/env1/package.json** | ✅ |
| [react](https://github.com/facebook/react) | \`^17.0.0\` → \`^18.0.0\` | **packages/launchpad/test-envs/env2/package.json** | ✅ |
`,
        head: 'buddy-bot/update-test-envs',
        author: 'github-actions[bot]',
      }

      const mockUpdates = [
        { name: 'lodash', currentVersion: '^4.0.0', newVersion: '^4.17.21', updateType: 'patch' as const },
        { name: 'react', currentVersion: '^17.0.0', newVersion: '^18.0.0', updateType: 'major' as const },
      ]

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoClosePR(mockPR, mockUpdates)
      expect(shouldClose).toBe(true)
    })

    it('should not auto-close PRs for files outside ignorePaths', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['packages/launchpad/test-envs/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update main dependencies',
        body: `
## Updates

| Package | Version | File | Status |
|---------|---------|------|--------|
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/ui/package.json** | ✅ |
| [react](https://github.com/facebook/react) | \`^17.0.0\` → \`^18.0.0\` | **src/package.json** | ✅ |
`,
        head: 'buddy-bot/update-main',
        author: 'github-actions[bot]',
      }

      const mockUpdates = [
        { name: 'lodash', currentVersion: '^4.0.0', newVersion: '^4.17.21', updateType: 'patch' as const },
        { name: 'react', currentVersion: '^17.0.0', newVersion: '^18.0.0', updateType: 'major' as const },
      ]

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoClosePR(mockPR, mockUpdates)
      expect(shouldClose).toBe(false)
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle invalid glob patterns gracefully', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['[invalid-glob-pattern'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update dependencies',
        body: `
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/test/package.json** | ✅ |
`,
        head: 'buddy-bot/update-test',
        author: 'github-actions[bot]',
      }

      // Should not throw and should return false
      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoCloseForIgnorePaths(mockPR)
      expect(shouldClose).toBe(false)
    })

    it('should handle PRs with complex file path formats', async () => {
      const config: BuddyBotConfig = {
        repository: { provider: 'github', owner: 'test', name: 'test' },
        packages: {
          strategy: 'all',
          ignorePaths: ['packages/*/test-envs/**'],
        },
      }

      const buddy = new Buddy(config, testDir)

      const mockPR = {
        number: 1,
        title: 'Update dependencies',
        body: `
## Complex Update

Updates in multiple formats:
- packages/launchpad/test-envs/env1/package.json
- packages/ui/test-envs/env2/deps.yaml
- Regular file: src/main/package.json

| Package | Version | File | Status |
|---------|---------|------|--------|
| [lodash](https://github.com/lodash/lodash) | \`^4.0.0\` → \`^4.17.21\` | **packages/core/test-envs/package.json** | ✅ |
`,
        head: 'buddy-bot/update-complex',
        author: 'github-actions[bot]',
      }

      // @ts-expect-error - accessing private method for testing
      const shouldClose = buddy.shouldAutoCloseForIgnorePaths(mockPR)
      expect(shouldClose).toBe(true)
    })
  })
})
