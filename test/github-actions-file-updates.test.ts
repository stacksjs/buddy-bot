import type { PackageUpdate } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

const mockWorkflowContent = `
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Cache dependencies
        uses: actions/cache@v4.1.0
        with:
          path: ~/.bun
          key: \${{ runner.os }}-bun-\${{ hashFiles('**/bun.lockb') }}
          restore-keys: |
            \${{ runner.os }}-bun-

      - name: Install dependencies
        run: bun install

      - name: Run tests
        run: bun test

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Build project
        run: bun run build
`

const mockComplexWorkflow = `
name: Release
on:
  push:
    tags: ['v*']

env:
  NODE_VERSION: 18

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3.5.0
      - uses: "actions/setup-node@v4.0.0"
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v3.5.0
      - uses: 'actions/setup-node@v4.0.0'
        with:
          node-version: \${{ env.NODE_VERSION }}
      - run: npm ci
      - run: npm test

  release:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3.5.0
      - uses: crazy-max/ghaction-docker-buildx@v3.1.0
      - name: Release
        uses: stacksjs/action-releaser@v1.0.0
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
`

describe('GitHub Actions File Updates', () => {
  let readFileSpy: any
  let existsSyncSpy: any

  beforeEach(async () => {
    // Mock filesystem functions
    readFileSpy = spyOn(await import('node:fs'), 'readFileSync')
    existsSyncSpy = spyOn(await import('node:fs'), 'existsSync')
  })

  afterEach(() => {
    readFileSpy?.mockRestore()
    existsSyncSpy?.mockRestore()
  })

  describe('updateGitHubActionsFile', () => {
    it('should update single action version correctly', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const updates: PackageUpdate[] = [{
        name: 'actions/checkout',
        currentVersion: 'v4',
        newVersion: 'v4.2.2',
        updateType: 'patch',
        dependencyType: 'github-actions',
        file: '.github/workflows/ci.yml',
      }]

      const result = await updateGitHubActionsFile('.github/workflows/ci.yml', mockWorkflowContent, updates)

      // Should update all occurrences of actions/checkout@v4
      expect(result).toContain('uses: actions/checkout@v4.2.2')
      expect(result).not.toMatch(/uses:\s+actions\/checkout@v4(?!\.)/)

      // Should not affect other actions
      expect(result).toContain('uses: oven-sh/setup-bun@v2')
      expect(result).toContain('uses: actions/cache@v4.1.0')

      // Should preserve all other content
      expect(result).toContain('name: CI')
      expect(result).toContain('runs-on: ubuntu-latest')
      expect(result).toContain('run: bun install')
    })

    it('should update multiple different actions', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const updates: PackageUpdate[] = [
        {
          name: 'actions/checkout',
          currentVersion: 'v4',
          newVersion: 'v4.2.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'oven-sh/setup-bun',
          currentVersion: 'v2',
          newVersion: 'v2.0.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'actions/cache',
          currentVersion: 'v4.1.0',
          newVersion: 'v4.2.3',
          updateType: 'minor',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
      ]

      const result = await updateGitHubActionsFile('.github/workflows/ci.yml', mockWorkflowContent, updates)

      // Should update all specified actions
      expect(result).toContain('uses: actions/checkout@v4.2.2')
      expect(result).toContain('uses: oven-sh/setup-bun@v2.0.2')
      expect(result).toContain('uses: actions/cache@v4.2.3')

      // Should not contain old versions
      expect(result).not.toMatch(/uses:\s+actions\/checkout@v4(?!\.)/)
      expect(result).not.toMatch(/uses:\s+oven-sh\/setup-bun@v2(?!\.)/)
      expect(result).not.toContain('uses: actions/cache@v4.1.0')
    })

    it('should handle complex workflow with quoted action names', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const updates: PackageUpdate[] = [
        {
          name: 'actions/checkout',
          currentVersion: 'v3.5.0',
          newVersion: 'v4.2.2',
          updateType: 'major',
          dependencyType: 'github-actions',
          file: '.github/workflows/release.yml',
        },
        {
          name: 'actions/setup-node',
          currentVersion: 'v4.0.0',
          newVersion: 'v4.0.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/release.yml',
        },
        {
          name: 'crazy-max/ghaction-docker-buildx',
          currentVersion: 'v3.1.0',
          newVersion: 'v3.2.0',
          updateType: 'minor',
          dependencyType: 'github-actions',
          file: '.github/workflows/release.yml',
        },
      ]

      const result = await updateGitHubActionsFile('.github/workflows/release.yml', mockComplexWorkflow, updates)

      // Should update all occurrences, including quoted ones
      expect(result).toContain('uses: actions/checkout@v4.2.2')
      expect(result).toContain('uses: "actions/setup-node@v4.0.2"')
      expect(result).toContain('uses: crazy-max/ghaction-docker-buildx@v3.2.0')

      // Should not contain old versions
      expect(result).not.toContain('@v3.5.0')
      expect(result).not.toContain('@v4.0.0')
      expect(result).not.toContain('@v3.1.0')

      // Should preserve matrix strategy and other complex structures
      expect(result).toContain('strategy:')
      expect(result).toContain('matrix:')
      expect(result).toContain('os: [ubuntu-latest, windows-latest, macos-latest]')
      expect(result).toContain('needs: [lint, test]')
    })

    it('should handle special characters in action names correctly', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const workflowWithSpecialActions = `
jobs:
  test:
    steps:
      - uses: crazy-max/ghaction-docker-buildx@v3.1.0
      - uses: docker/setup-buildx-action@v3.0.0
      - uses: actions/upload-artifact@v4.0.0
      - uses: github/super-linter@v4.9.0
`

      const updates: PackageUpdate[] = [
        {
          name: 'crazy-max/ghaction-docker-buildx',
          currentVersion: 'v3.1.0',
          newVersion: 'v3.2.0',
          updateType: 'minor',
          dependencyType: 'github-actions',
          file: '.github/workflows/test.yml',
        },
        {
          name: 'docker/setup-buildx-action',
          currentVersion: 'v3.0.0',
          newVersion: 'v3.1.0',
          updateType: 'minor',
          dependencyType: 'github-actions',
          file: '.github/workflows/test.yml',
        },
      ]

      const result = await updateGitHubActionsFile('.github/workflows/test.yml', workflowWithSpecialActions, updates)

      expect(result).toContain('uses: crazy-max/ghaction-docker-buildx@v3.2.0')
      expect(result).toContain('uses: docker/setup-buildx-action@v3.1.0')

      // Should not affect other actions
      expect(result).toContain('uses: actions/upload-artifact@v4.0.0')
      expect(result).toContain('uses: github/super-linter@v4.9.0')
    })

    it('should preserve exact whitespace and formatting', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const formattedWorkflow = `
jobs:
  test:
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup
        uses:   oven-sh/setup-bun@v2   # with extra spaces

      -   uses: actions/cache@v4.1.0    # different indentation
          with:
            path: |
              ~/.cache
              node_modules
`

      const updates: PackageUpdate[] = [{
        name: 'actions/checkout',
        currentVersion: 'v4',
        newVersion: 'v4.2.2',
        updateType: 'patch',
        dependencyType: 'github-actions',
        file: '.github/workflows/test.yml',
      }]

      const result = await updateGitHubActionsFile('.github/workflows/test.yml', formattedWorkflow, updates)

      // Should update the version but preserve formatting
      expect(result).toContain('uses: actions/checkout@v4.2.2')
      expect(result).toContain('uses:   oven-sh/setup-bun@v2   # with extra spaces')
      expect(result).toContain('-   uses: actions/cache@v4.1.0    # different indentation')

      // Should preserve with: blocks and indentation
      expect(result).toContain('with:\n          fetch-depth: 0')
      expect(result).toContain('path: |\n              ~/.cache\n              node_modules')
    })

    it('should not update non-matching actions', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const updates: PackageUpdate[] = [{
        name: 'actions/checkout',
        currentVersion: 'v3', // This version doesn't exist in the workflow
        newVersion: 'v4.2.2',
        updateType: 'major',
        dependencyType: 'github-actions',
        file: '.github/workflows/ci.yml',
      }]

      const result = await updateGitHubActionsFile('.github/workflows/ci.yml', mockWorkflowContent, updates)

      // Should not change anything since v3 doesn't exist in the workflow (it has v4)
      expect(result).toBe(mockWorkflowContent)
    })

    it('should handle empty updates list', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const result = await updateGitHubActionsFile('.github/workflows/ci.yml', mockWorkflowContent, [])

      expect(result).toBe(mockWorkflowContent)
    })
  })

  describe('generateGitHubActionsUpdates', () => {
    it('should generate file updates for multiple workflow files', async () => {
      const { generateGitHubActionsUpdates } = await import('../src/utils/github-actions-parser')

      existsSyncSpy.mockReturnValue(true)
      readFileSpy
        .mockReturnValueOnce(mockWorkflowContent) // ci.yml
        .mockReturnValueOnce(mockComplexWorkflow) // release.yml

      const updates: PackageUpdate[] = [
        {
          name: 'actions/checkout',
          currentVersion: 'v4',
          newVersion: 'v4.2.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'actions/checkout',
          currentVersion: 'v3.5.0',
          newVersion: 'v4.2.2',
          updateType: 'major',
          dependencyType: 'github-actions',
          file: '.github/workflows/release.yml',
        },
        {
          name: 'oven-sh/setup-bun',
          currentVersion: 'v2',
          newVersion: 'v2.0.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
      ]

      const result = await generateGitHubActionsUpdates(updates)

      expect(result).toHaveLength(2) // Two different files

      // Check ci.yml updates
      const ciUpdate = result.find(r => r.path === '.github/workflows/ci.yml')
      expect(ciUpdate).toBeTruthy()
      expect(ciUpdate!.type).toBe('update')
      expect(ciUpdate!.content).toContain('uses: actions/checkout@v4.2.2')
      expect(ciUpdate!.content).toContain('uses: oven-sh/setup-bun@v2.0.2')

      // Check release.yml updates
      const releaseUpdate = result.find(r => r.path === '.github/workflows/release.yml')
      expect(releaseUpdate).toBeTruthy()
      expect(releaseUpdate!.type).toBe('update')
      expect(releaseUpdate!.content).toContain('uses: actions/checkout@v4.2.2')
      expect(releaseUpdate!.content).not.toContain('uses: actions/checkout@v3.5.0')
    })

    it('should group updates by file correctly', async () => {
      const { generateGitHubActionsUpdates } = await import('../src/utils/github-actions-parser')

      existsSyncSpy.mockReturnValue(true)
      readFileSpy.mockReturnValue(mockWorkflowContent)

      const updates: PackageUpdate[] = [
        {
          name: 'actions/checkout',
          currentVersion: 'v4',
          newVersion: 'v4.2.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'oven-sh/setup-bun',
          currentVersion: 'v2',
          newVersion: 'v2.0.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'actions/cache',
          currentVersion: 'v4.1.0',
          newVersion: 'v4.2.3',
          updateType: 'minor',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
      ]

      const result = await generateGitHubActionsUpdates(updates)

      expect(result).toHaveLength(1) // All updates for same file

      const fileUpdate = result[0]
      expect(fileUpdate.path).toBe('.github/workflows/ci.yml')

      // Should contain all three updates
      expect(fileUpdate.content).toContain('uses: actions/checkout@v4.2.2')
      expect(fileUpdate.content).toContain('uses: oven-sh/setup-bun@v2.0.2')
      expect(fileUpdate.content).toContain('uses: actions/cache@v4.2.3')
    })

    it('should skip non-existent files', async () => {
      const { generateGitHubActionsUpdates } = await import('../src/utils/github-actions-parser')

      existsSyncSpy.mockReturnValue(false)

      const updates: PackageUpdate[] = [{
        name: 'actions/checkout',
        currentVersion: 'v4',
        newVersion: 'v4.2.2',
        updateType: 'patch',
        dependencyType: 'github-actions',
        file: '.github/workflows/nonexistent.yml',
      }]

      const result = await generateGitHubActionsUpdates(updates)

      expect(result).toHaveLength(0)
      expect(readFileSpy).not.toHaveBeenCalled()
    })

    it('should filter out non-GitHub Actions updates', async () => {
      const { generateGitHubActionsUpdates } = await import('../src/utils/github-actions-parser')

      const mixedUpdates: PackageUpdate[] = [
        {
          name: 'actions/checkout',
          currentVersion: 'v4',
          newVersion: 'v4.2.2',
          updateType: 'patch',
          dependencyType: 'github-actions',
          file: '.github/workflows/ci.yml',
        },
        {
          name: 'lodash',
          currentVersion: '^4.17.20',
          newVersion: '^4.17.21',
          updateType: 'patch',
          dependencyType: 'dependencies',
          file: 'package.json',
        },
        {
          name: 'bun.sh',
          currentVersion: '^1.2.16',
          newVersion: '^1.2.19',
          updateType: 'patch',
          dependencyType: 'dependencies',
          file: 'deps.yaml',
        },
      ]

      existsSyncSpy.mockReturnValue(true)
      readFileSpy.mockReturnValue(mockWorkflowContent)

      const result = await generateGitHubActionsUpdates(mixedUpdates)

      // Should only process GitHub Actions files
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('.github/workflows/ci.yml')
      expect(existsSyncSpy).toHaveBeenCalledTimes(1)
      expect(readFileSpy).toHaveBeenCalledTimes(1)
    })

    it('should handle file read errors gracefully', async () => {
      const { generateGitHubActionsUpdates } = await import('../src/utils/github-actions-parser')

      existsSyncSpy.mockReturnValue(true)
      readFileSpy.mockImplementation(() => {
        throw new Error('Permission denied')
      })

      const updates: PackageUpdate[] = [{
        name: 'actions/checkout',
        currentVersion: 'v4',
        newVersion: 'v4.2.2',
        updateType: 'patch',
        dependencyType: 'github-actions',
        file: '.github/workflows/ci.yml',
      }]

      const result = await generateGitHubActionsUpdates(updates)

      expect(result).toHaveLength(0) // Should handle error gracefully
    })
  })

  describe('regex pattern safety', () => {
    it('should handle action names with special regex characters', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const workflowWithSpecialChars = `
jobs:
  test:
    steps:
      - uses: crazy-max/ghaction-docker-buildx@v3.1.0
      - uses: some-org/action.with.dots@v1.0.0
      - uses: user/action-with-dashes@v2.0.0
`

      const updates: PackageUpdate[] = [{
        name: 'crazy-max/ghaction-docker-buildx',
        currentVersion: 'v3.1.0',
        newVersion: 'v3.2.0',
        updateType: 'minor',
        dependencyType: 'github-actions',
        file: '.github/workflows/test.yml',
      }]

      const result = await updateGitHubActionsFile('.github/workflows/test.yml', workflowWithSpecialChars, updates)

      // Should correctly escape special characters and update only the intended action
      expect(result).toContain('uses: crazy-max/ghaction-docker-buildx@v3.2.0')
      expect(result).toContain('uses: some-org/action.with.dots@v1.0.0') // Unchanged
      expect(result).toContain('uses: user/action-with-dashes@v2.0.0') // Unchanged
    })

    it('should handle version strings with special regex characters', async () => {
      const { updateGitHubActionsFile } = await import('../src/utils/github-actions-parser')

      const workflowWithSpecialVersions = `
jobs:
  test:
    steps:
      - uses: actions/checkout@v4.1.0
      - uses: other/action@v2.0.0-beta.1
      - uses: another/action@1.2.3+build.456
`

      const updates: PackageUpdate[] = [{
        name: 'other/action',
        currentVersion: 'v2.0.0-beta.1',
        newVersion: 'v2.0.0',
        updateType: 'patch',
        dependencyType: 'github-actions',
        file: '.github/workflows/test.yml',
      }]

      const result = await updateGitHubActionsFile('.github/workflows/test.yml', workflowWithSpecialVersions, updates)

      // Should correctly handle versions with special characters
      expect(result).toContain('uses: other/action@v2.0.0')
      expect(result).not.toContain('uses: other/action@v2.0.0-beta.1')

      // Should not affect other actions
      expect(result).toContain('uses: actions/checkout@v4.1.0')
      expect(result).toContain('uses: another/action@1.2.3+build.456')
    })
  })
})
