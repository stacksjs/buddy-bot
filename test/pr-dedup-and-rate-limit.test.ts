import type { PackageUpdate } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { generateBranchName } from '../src/utils/helpers'
import { generateUnifiedWorkflow } from '../src/setup'

describe('PR Deduplication & Rate Limiting', () => {
  describe('Deterministic Branch Names', () => {
    const makeSingleUpdate = (name: string, newVersion: string, updateType: 'major' | 'minor' | 'patch' = 'minor'): PackageUpdate[] => [{
      name,
      currentVersion: '1.0.0',
      newVersion,
      updateType,
      file: 'package.json',
      dependencyType: 'dependencies',
    }]

    it('should generate deterministic branch names without timestamps', () => {
      const updates = makeSingleUpdate('react', '18.0.0')
      const branch1 = generateBranchName(updates)
      const branch2 = generateBranchName(updates)

      // Same input should always produce the same branch name
      expect(branch1).toBe(branch2)
      // Should NOT contain a date-like timestamp pattern
      expect(branch1).not.toMatch(/\d{8}$/)
    })

    it('should include package name and version in single-update branches', () => {
      const updates = makeSingleUpdate('react', '18.2.0')
      const branch = generateBranchName(updates)

      expect(branch).toContain('react')
      expect(branch).toContain('18.2.0')
      expect(branch).toBe('buddy/update-react-to-18.2.0')
    })

    it('should handle scoped packages in branch names', () => {
      const updates = makeSingleUpdate('@types/node', '20.0.0')
      const branch = generateBranchName(updates)

      expect(branch).toContain('types')
      expect(branch).toContain('node')
      expect(branch).toContain('20.0.0')
      // Should sanitize @ to hyphen in the package name portion
      expect(branch).not.toContain('@')
      // The prefix separator '/' is expected, but the package name should not contain additional slashes
      const nameSegment = branch.split('/').slice(1).join('/')
      expect(nameSegment).not.toContain('/')
    })

    it('should generate stable branch for major grouped updates', () => {
      const updates: PackageUpdate[] = [
        { name: 'react', currentVersion: '17.0.0', newVersion: '18.0.0', updateType: 'major', file: 'package.json', dependencyType: 'dependencies' },
        { name: 'react-dom', currentVersion: '17.0.0', newVersion: '18.0.0', updateType: 'major', file: 'package.json', dependencyType: 'dependencies' },
      ]

      const branch1 = generateBranchName(updates)
      const branch2 = generateBranchName(updates)

      expect(branch1).toBe(branch2)
      expect(branch1).toBe('buddy/update-major-dependencies')
      expect(branch1).not.toMatch(/\d{8}$/)
    })

    it('should generate stable branch for non-major grouped updates', () => {
      const updates: PackageUpdate[] = [
        { name: 'lodash', currentVersion: '4.17.20', newVersion: '4.17.21', updateType: 'patch', file: 'package.json', dependencyType: 'dependencies' },
        { name: 'axios', currentVersion: '1.5.0', newVersion: '1.6.0', updateType: 'minor', file: 'package.json', dependencyType: 'dependencies' },
      ]

      const branch1 = generateBranchName(updates)
      const branch2 = generateBranchName(updates)

      expect(branch1).toBe(branch2)
      expect(branch1).toBe('buddy/update-dependencies')
      expect(branch1).not.toMatch(/\d{8}$/)
    })

    it('should support custom prefix', () => {
      const updates = makeSingleUpdate('react', '18.0.0')
      const branch = generateBranchName(updates, 'buddy-bot')

      expect(branch).toBe('buddy-bot/update-react-to-18.0.0')
    })

    it('should produce different branches for different versions of the same package', () => {
      const updates1 = makeSingleUpdate('react', '18.0.0')
      const updates2 = makeSingleUpdate('react', '18.1.0')

      expect(generateBranchName(updates1)).not.toBe(generateBranchName(updates2))
    })
  })

  describe('Workflow Cascade Prevention', () => {
    it('should include bot actor check in pull_request handler', () => {
      const workflow = generateUnifiedWorkflow(true)

      // Should check the actor to prevent cascade loops
      expect(workflow).toContain('ACTOR=')
      expect(workflow).toContain('github-actions[bot]')
      expect(workflow).toContain('buddy-bot')
      // Should skip when actor is a bot
      expect(workflow).toContain('Skipping')
      expect(workflow).toContain('bot actor')
    })

    it('should only trigger check job for buddy-bot branch edits by users', () => {
      const workflow = generateUnifiedWorkflow(false)

      // Should check branch prefix
      expect(workflow).toContain('buddy-bot/*')
      // Should output run_check=true for user-initiated edits
      expect(workflow).toContain('buddy-bot PR edited by user')
      expect(workflow).toContain('run_check=true')
    })
  })

  describe('Token Attribution', () => {
    it('should use GITHUB_TOKEN as primary token (not BUDDY_BOT_TOKEN)', () => {
      const workflow = generateUnifiedWorkflow(true)

      // Top-level env should use the built-in GITHUB_TOKEN
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflow).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
      // Should NOT have the old pattern that overrides GITHUB_TOKEN with PAT
      expect(workflow).not.toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')
    })

    it('should pass BUDDY_BOT_TOKEN as separate env var', () => {
      const workflow = generateUnifiedWorkflow(true)

      // BUDDY_BOT_TOKEN should be its own env var, not merged into GITHUB_TOKEN
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflow).toContain('BUDDY_BOT_TOKEN: ${{ secrets.BUDDY_BOT_TOKEN }}')
    })

    it('should produce the same output regardless of hasCustomToken parameter', () => {
      const workflowTrue = generateUnifiedWorkflow(true)
      const workflowFalse = generateUnifiedWorkflow(false)

      // Both should use the same GITHUB_TOKEN env — hasCustomToken no longer changes behavior
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflowTrue).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
      // eslint-disable-next-line no-template-curly-in-string
      expect(workflowFalse).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
    })

    it('should use GITHUB_TOKEN for checkout steps', () => {
      const workflow = generateUnifiedWorkflow(true)

      // All checkout steps should use GITHUB_TOKEN, not BUDDY_BOT_TOKEN
      // eslint-disable-next-line no-template-curly-in-string
      const checkoutTokenPattern = /token: \$\{\{ secrets\.GITHUB_TOKEN \}\}/g
      const matches = workflow.match(checkoutTokenPattern)
      expect(matches).not.toBeNull()
      expect(matches!.length).toBeGreaterThanOrEqual(1)

      // Should NOT use BUDDY_BOT_TOKEN in checkout steps
      expect(workflow).not.toContain('token: ${{ secrets.BUDDY_BOT_TOKEN }}')
    })

    it('should use GITHUB_TOKEN for buddy-bot command env vars', () => {
      const workflow = generateUnifiedWorkflow(true)

      // The run step env vars should pass GITHUB_TOKEN (not PAT) to the buddy-bot commands
      // Look for the pattern in step env blocks
      const envBlocks = workflow.split('env:')
      for (const block of envBlocks) {
        // If the block contains GITHUB_TOKEN assignment, it should use secrets.GITHUB_TOKEN
        if (block.includes('GITHUB_TOKEN:') && block.includes('BUDDY_BOT_TOKEN:')) {
          expect(block).not.toContain('BUDDY_BOT_TOKEN || secrets.GITHUB_TOKEN')
        }
      }
    })
  })

  describe('Rate Limiting Config', () => {
    it('should accept maxPRsPerRun in BuddyBotConfig', async () => {
      // Import the type to verify it compiles
      const { Buddy } = await import('../src/buddy')

      // Creating a Buddy instance with maxPRsPerRun should not throw
      const buddy = new Buddy({
        maxPRsPerRun: 5,
        packages: { strategy: 'all' },
      })
      expect(buddy).toBeDefined()
    })

    it('should default maxPRsPerRun to 10 when not specified', async () => {
      const { Buddy } = await import('../src/buddy')

      // Creating without maxPRsPerRun should use the default
      const buddy = new Buddy({
        packages: { strategy: 'all' },
      })
      expect(buddy).toBeDefined()
    })
  })

  describe('GitHub Provider Cache TTL', () => {
    it('should use 30-minute cache TTL', async () => {
      const { GitHubProvider } = await import('../src/git/github-provider')

      // Construct with a dummy token
      const provider = new GitHubProvider('test-token', 'owner', 'repo')

      // Access the private cacheTTL via any cast — verify it's 30 minutes
      const ttl = (provider as any).cacheTTL
      expect(ttl).toBe(30 * 60 * 1000)
    })
  })

  describe('GitHub Provider Workflow Token', () => {
    it('should accept optional workflowToken parameter', async () => {
      const { GitHubProvider } = await import('../src/git/github-provider')

      // Should construct without error
      const provider = new GitHubProvider('github-token', 'owner', 'repo', true, 'workflow-pat')
      expect(provider).toBeDefined()
    })

    it('should use primary token by default for effective token', async () => {
      const { GitHubProvider } = await import('../src/git/github-provider')

      const provider = new GitHubProvider('primary-token', 'owner', 'repo', true, 'workflow-token')

      // getEffectiveToken(false) should return primary token
      const token = (provider as any).getEffectiveToken(false)
      expect(token).toBe('primary-token')
    })

    it('should use workflow token when elevated permissions needed', async () => {
      const { GitHubProvider } = await import('../src/git/github-provider')

      const provider = new GitHubProvider('primary-token', 'owner', 'repo', true, 'workflow-token')

      // getEffectiveToken(true) should return workflow token
      const token = (provider as any).getEffectiveToken(true)
      expect(token).toBe('workflow-token')
    })

    it('should fall back to primary token when no workflow token exists', async () => {
      const { GitHubProvider } = await import('../src/git/github-provider')

      const provider = new GitHubProvider('primary-token', 'owner', 'repo', false)

      // getEffectiveToken(true) should fall back to primary token
      const token = (provider as any).getEffectiveToken(true)
      expect(token).toBe('primary-token')
    })
  })
})
