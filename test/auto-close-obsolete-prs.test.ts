/* eslint-disable ts/no-require-imports */
import type { BuddyBotConfig, PullRequest } from '../src/types'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Buddy } from '../src/buddy'

describe('Auto-close obsolete PRs', () => {
  const mockConfig: BuddyBotConfig = {
    repository: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
    },
    packages: {
      strategy: 'patch',
    },
  }

  let mockGitProvider: any

  beforeEach(() => {
    mockGitProvider = {
      getPullRequests: mock(() => Promise.resolve([])),
      createComment: mock(() => Promise.resolve()),
      closePullRequest: mock(() => Promise.resolve()),
      deleteBranch: mock(() => Promise.resolve()),
    }
  })

  it('should detect composer PRs when composer.json is removed', async () => {
    const buddy = new Buddy(mockConfig, '/tmp/test-project')

    // Mock PR with composer.json reference
    const composerPR: PullRequest = {
      number: 123,
      title: 'chore(deps): update composer dependencies',
      body: `
## Updates

| Package | Version | **File** | Status |
|---------|---------|----------|--------|
| [laravel/framework](https://github.com/laravel/framework) | ^8.0 → ^9.0 | **composer.json** | ✅ |
      `,
      head: 'buddy-bot/update-composer-123',
      base: 'main',
      author: 'github-actions[bot]',
      url: 'https://github.com/test-owner/test-repo/pull/123',
      labels: ['dependencies', 'composer'],
      state: 'open',
      reviewers: [],
      assignees: [],
      draft: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mockGitProvider.getPullRequests.mockResolvedValue([composerPR])

    // Mock fs.existsSync to return false for composer.json (file removed)
    const originalExistsSync = require('node:fs').existsSync
    require('node:fs').existsSync = mock((path: string) => {
      if (path.includes('composer.json'))
        return false
      return originalExistsSync(path)
    })

    await buddy.checkAndCloseObsoletePRs(mockGitProvider as any, false)

    // Verify PR was closed with correct comment
    expect(mockGitProvider.createComment).toHaveBeenCalledTimes(1)
    const [prNumber, comment] = mockGitProvider.createComment.mock.calls[0]
    expect(prNumber).toBe(123)
    expect(comment).toContain('`composer.json` has been removed')
    expect(mockGitProvider.closePullRequest).toHaveBeenCalledWith(123)
    expect(mockGitProvider.deleteBranch).toHaveBeenCalledWith('buddy-bot/update-composer-123')

    // Restore original function
    require('node:fs').existsSync = originalExistsSync
  })

  it('should not close PRs when dependency files still exist', async () => {
    const buddy = new Buddy(mockConfig, '/tmp/test-project')

    const packageJsonPR: PullRequest = {
      number: 456,
      title: 'chore(deps): update npm dependencies',
      body: `
## Updates

| Package | Version | **File** | Status |
|---------|---------|----------|--------|
| [react](https://github.com/facebook/react) | ^17.0 → ^18.0 | **package.json** | ✅ |
      `,
      head: 'buddy-bot/update-npm-456',
      base: 'main',
      author: 'github-actions[bot]',
      url: 'https://github.com/test-owner/test-repo/pull/456',
      labels: ['dependencies'],
      state: 'open',
      reviewers: [],
      assignees: [],
      draft: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mockGitProvider.getPullRequests.mockResolvedValue([packageJsonPR])

    // Mock fs.existsSync to return true for package.json (file exists)
    const originalExistsSync = require('node:fs').existsSync
    require('node:fs').existsSync = mock(() => true) // All files exist

    await buddy.checkAndCloseObsoletePRs(mockGitProvider as any, false)

    // Verify PR was NOT closed
    expect(mockGitProvider.createComment).not.toHaveBeenCalled()
    expect(mockGitProvider.closePullRequest).not.toHaveBeenCalled()

    // Restore original function
    require('node:fs').existsSync = originalExistsSync
  })

  it('should work in dry-run mode', async () => {
    const buddy = new Buddy(mockConfig, '/tmp/test-project')

    const composerPR: PullRequest = {
      number: 789,
      title: 'chore(deps): update composer dependencies',
      body: `**composer.json** updates available`,
      head: 'buddy-bot/update-composer-789',
      base: 'main',
      author: 'github-actions[bot]',
      url: 'https://github.com/test-owner/test-repo/pull/789',
      labels: ['dependencies'],
      state: 'open',
      reviewers: [],
      assignees: [],
      draft: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mockGitProvider.getPullRequests.mockResolvedValue([composerPR])

    // Mock fs.existsSync to return false for composer.json
    const originalExistsSync = require('node:fs').existsSync
    require('node:fs').existsSync = mock((path: string) => {
      if (path.includes('composer.json'))
        return false
      return true
    })

    await buddy.checkAndCloseObsoletePRs(mockGitProvider as any, true) // dry-run = true

    // Verify PR was NOT actually closed in dry-run mode
    expect(mockGitProvider.createComment).not.toHaveBeenCalled()
    expect(mockGitProvider.closePullRequest).not.toHaveBeenCalled()

    // Restore original function
    require('node:fs').existsSync = originalExistsSync
  })
})
