import type { DashboardData, PackageFile, PullRequest } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { DashboardGenerator } from '../src/dashboard/dashboard-generator'

describe('DashboardGenerator', () => {
  const generator = new DashboardGenerator()

  describe('generateDashboard', () => {
    const mockDashboardData: DashboardData = {
      repository: {
        owner: 'test-owner',
        name: 'test-repo',
        provider: 'github',
      },
      openPRs: [],
      detectedDependencies: {
        packageJson: [],
        dependencyFiles: [],
        githubActions: [],
      },
      lastUpdated: new Date('2024-01-01T00:00:00Z'),
    }

    it('should generate dashboard with default template', () => {
      const result = generator.generateDashboard(mockDashboardData)

      expect(result.title).toBe('Dependency Dashboard')
      expect(result.body).toContain('This issue lists Buddy Bot updates and detected dependencies')
      expect(result.body).toContain('## Detected dependencies')
    })

    it('should include open PRs section when PRs exist', () => {
      const dataWithPRs: DashboardData = {
        ...mockDashboardData,
        openPRs: [
          {
            number: 123,
            title: 'chore(deps): update dependency react to v18',
            body: 'Test PR body',
            head: 'update-react',
            base: 'main',
            state: 'open',
            url: 'https://github.com/test-owner/test-repo/pull/123',
            createdAt: new Date(),
            updatedAt: new Date(),
            author: 'buddy-bot',
            reviewers: [],
            assignees: [],
            labels: ['dependencies'],
            draft: false,
          },
        ],
      }

      const result = generator.generateDashboard(dataWithPRs)

      expect(result.body).toContain('## Open')
      expect(result.body).toContain('The following updates have all been created')
    })

    it('should skip sections when showOpenPRs or showDetectedDependencies is false', () => {
      const dataWithPRs: DashboardData = {
        ...mockDashboardData,
        openPRs: [
          {
            number: 123,
            title: 'chore(deps): update dependency react to v18',
            body: 'Test PR body',
            head: 'update-react',
            base: 'main',
            state: 'open',
            url: 'https://github.com/test-owner/test-repo/pull/123',
            createdAt: new Date(),
            updatedAt: new Date(),
            author: 'buddy-bot',
            reviewers: [],
            assignees: [],
            labels: ['dependencies'],
            draft: false,
          },
        ],
      }

      const result = generator.generateDashboard(dataWithPRs, {
        showOpenPRs: false,
        showDetectedDependencies: false,
      })

      expect(result.body).not.toContain('## Open')
      expect(result.body).not.toContain('## Detected dependencies')
    })
  })

  describe('Open PRs section', () => {
    describe('package extraction from PR bodies', () => {
      it('should extract package names from enhanced PR table format', () => {
        const prWithTable: PullRequest = {
          number: 123,
          title: 'chore(deps): update all non-major dependencies',
          body: `This PR contains the following updates:

### npm Dependencies

| Package | Change | Age | Adoption | Passing | Confidence |
|---|---|---|---|---|---|
| [@types/bun](https://redirect.github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/bun) | [\`1.2.17\` -> \`1.2.19\`](https://renovatebot.com/diffs/npm/%40types%2Fbun/1.2.17/1.2.19) | [![age](badge)] | [![adoption](badge)] | [![passing](badge)] | [![confidence](badge)] |
| [cac](https://github.com/egoist/cac) | [\`6.7.13\` -> \`6.7.14\`](https://renovatebot.com/diffs/npm/cac/6.7.13/6.7.14) | [![age](badge)] | [![adoption](badge)] | [![passing](badge)] | [![confidence](badge)] |
| [ts-pkgx](https://github.com/stacksjs/ts-pkgx) | [\`0.4.4\` -> \`0.4.7\`](https://renovatebot.com/diffs/npm/ts-pkgx/0.4.4/0.4.7) | [![age](badge)] | [![adoption](badge)] | [![passing](badge)] | [![confidence](badge)] |

### GitHub Actions

| Action | Change | File | Status |
|---|---|---|---|
| [actions/checkout](https://github.com/actions/checkout) | \`v4\` -> \`v4.2.2\` | ci.yml | ✅ Available |

---`,
          head: 'update-deps',
          base: 'main',
          state: 'open',
          url: 'https://github.com/test-owner/test-repo/pull/123',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [prWithTable],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should extract package names from table format (npm packages from URLs + GitHub Actions)
        expect(result.body).toContain('(`@types/bun`, `cac`, `ts-pkgx`, `actions/checkout`')
      })

      it('should extract package names from simple title patterns', () => {
        const prWithSimpleTitle: PullRequest = {
          number: 124,
          title: 'chore(deps): update dependency react to v18',
          body: 'Simple PR body without tables',
          head: 'update-react',
          base: 'main',
          state: 'open',
          url: 'https://github.com/test-owner/test-repo/pull/124',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [prWithSimpleTitle],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should extract package name from title
        expect(result.body).toContain('(`react`)')
      })

      it('should fallback to backtick extraction when table format not available', () => {
        const prWithBackticks: PullRequest = {
          number: 125,
          title: 'chore(deps): update multiple dependencies',
          body: 'Update `lodash` and `react-dom` to latest versions',
          head: 'update-multiple',
          base: 'main',
          state: 'open',
          url: 'https://github.com/test-owner/test-repo/pull/125',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [prWithBackticks],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should extract package names from backticks
        expect(result.body).toContain('(`lodash`, `react-dom`)')
      })

      it('should limit package names to 5 to keep clean', () => {
        const prWithManyPackages: PullRequest = {
          number: 126,
          title: 'chore(deps): update many dependencies',
          body: 'Update `pkg1`, `pkg2`, `pkg3`, `pkg4`, `pkg5`, `pkg6`, `pkg7` packages',
          head: 'update-many',
          base: 'main',
          state: 'open',
          url: 'https://github.com/test-owner/test-repo/pull/126',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [prWithManyPackages],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should only show first 5 packages
        const packageMatch = result.body.match(/\(`([^`]+)`.*?\)/)?.[1]
        const packageCount = packageMatch?.split('`, `').length || 0
        expect(packageCount).toBeLessThanOrEqual(5)
      })

      it('should filter out version arrows and URLs from package extraction', () => {
        const prWithVersionInfo: PullRequest = {
          number: 127,
          title: 'chore(deps): update dependencies',
          body: 'Update `react 16.0.0 -> 18.0.0` and `https://example.com` and `Compare Source`',
          head: 'update-with-versions',
          base: 'main',
          state: 'open',
          url: 'https://github.com/test-owner/test-repo/pull/127',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [prWithVersionInfo],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should not extract invalid package names - check if there are any packages extracted
        // The test PR body contains things that should be filtered out
        // If packages were extracted, they should be clean names only
        const packageMatch = result.body.match(/\]\)\s+\(([^)]+)\)/)
        if (packageMatch) {
          const extractedPackages = packageMatch[1]
          expect(extractedPackages).not.toContain('->')
          expect(extractedPackages).not.toContain('Compare Source')
          expect(extractedPackages).not.toMatch(/https?:\/\//)
        }
        else {
          // If no packages extracted (which is expected for this test), verify no invalid content in PR listing
          expect(result.body).toContain('](../pull/127)')
        }
      })

      it('should handle real-world PR body with version arrows like the user is seeing', () => {
        const realWorldPR: PullRequest = {
          number: 20,
          title: 'chore(deps): update all non-major dependencies',
          body: `This PR contains the following updates:

### Dependencies

- \`@stacksjs/eslint-config\`: \`4.10.2-beta.3\` -> \`4.14.0-beta.3\`
- \`@types/bun\`: \`1.2.17\` -> \`1.2.19\`
- \`cac\`: \`6.7.13\` -> \`6.7.14\`
- \`ts-pkgx\`: \`0.4.4\` -> \`0.4.8\`
- Check \`bun.com\` for details

### Summary
Updated several packages including \`@stacksjs/eslint-config\`, \`@types/bun\`, \`cac\`, and \`ts-pkgx\`.`,
          head: 'buddy-bot/update-non-major-updates-1751575575536',
          base: 'main',
          state: 'open',
          url: 'https://github.com/test-owner/test-repo/pull/20',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [realWorldPR],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should extract only clean package names, not version strings
        expect(result.body).toContain('(`@stacksjs/eslint-config`, `@types/bun`, `cac`, `ts-pkgx`, `bun.com`')
        expect(result.body).not.toContain('1.2.17')
        expect(result.body).not.toContain('1.2.19')
        expect(result.body).not.toContain('6.7.13')
        expect(result.body).not.toContain('6.7.14')
        expect(result.body).not.toContain('0.4.4')
        expect(result.body).not.toContain('0.4.8')
      })
    })

    describe('relative URL conversion', () => {
      it('should convert full GitHub URLs to relative format', () => {
        const prWithFullUrl: PullRequest = {
          number: 123,
          title: 'chore(deps): update dependency react to v18',
          body: 'Test PR body',
          head: 'update-react',
          base: 'main',
          state: 'open',
          url: 'https://github.com/test-owner/test-repo/pull/123',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [prWithFullUrl],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should use relative URL format
        expect(result.body).toContain('](../pull/123)')
        expect(result.body).not.toContain('https://github.com/')
      })

      it('should preserve non-GitHub URLs as-is', () => {
        const prWithCustomUrl: PullRequest = {
          number: 124,
          title: 'chore(deps): update dependency react to v18',
          body: 'Test PR body',
          head: 'update-react',
          base: 'main',
          state: 'open',
          url: 'https://custom-git.company.com/pull/124',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [prWithCustomUrl],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should preserve custom URL
        expect(result.body).toContain('](https://custom-git.company.com/pull/124)')
      })
    })

    describe('rebase branch format', () => {
      it('should include rebase-branch comment with PR head', () => {
        const pr: PullRequest = {
          number: 123,
          title: 'chore(deps): update dependency react to v18',
          body: 'Test PR body',
          head: 'buddy-bot/update-react-123456',
          base: 'main',
          state: 'open',
          url: 'https://github.com/test-owner/test-repo/pull/123',
          createdAt: new Date(),
          updatedAt: new Date(),
          author: 'buddy-bot',
          reviewers: [],
          assignees: [],
          labels: ['dependencies'],
          draft: false,
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [pr],
          detectedDependencies: { packageJson: [], dependencyFiles: [], githubActions: [] },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should include rebase-branch comment
        expect(result.body).toContain('<!-- rebase-branch=buddy-bot/update-react-123456 -->')
      })
    })
  })

  describe('Detected Dependencies section', () => {
    describe('GitHub Actions deduplication', () => {
      it('should deduplicate identical actions within the same workflow file', () => {
        const githubActionsFile: PackageFile = {
          path: '.github/workflows/ci.yml',
          type: 'github-actions',
          content: 'workflow content',
          dependencies: [
            {
              name: 'actions/checkout',
              currentVersion: 'v4',
              type: 'github-actions',
              file: '.github/workflows/ci.yml',
            },
            {
              name: 'actions/checkout',
              currentVersion: 'v4',
              type: 'github-actions',
              file: '.github/workflows/ci.yml',
            },
            {
              name: 'actions/setup-node',
              currentVersion: 'v3',
              type: 'github-actions',
              file: '.github/workflows/ci.yml',
            },
            {
              name: 'actions/checkout',
              currentVersion: 'v4',
              type: 'github-actions',
              file: '.github/workflows/ci.yml',
            },
          ],
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [],
          detectedDependencies: {
            packageJson: [],
            dependencyFiles: [],
            githubActions: [githubActionsFile],
          },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should only show each action once
        const checkoutMatches = (result.body.match(/actions\/checkout v4/g) || []).length
        expect(checkoutMatches).toBe(1)

        const setupNodeMatches = (result.body.match(/actions\/setup-node v3/g) || []).length
        expect(setupNodeMatches).toBe(1)
      })

      it('should show different versions of the same action separately', () => {
        const githubActionsFile: PackageFile = {
          path: '.github/workflows/ci.yml',
          type: 'github-actions',
          content: 'workflow content',
          dependencies: [
            {
              name: 'actions/checkout',
              currentVersion: 'v4',
              type: 'github-actions',
              file: '.github/workflows/ci.yml',
            },
            {
              name: 'actions/checkout',
              currentVersion: 'v3',
              type: 'github-actions',
              file: '.github/workflows/ci.yml',
            },
          ],
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [],
          detectedDependencies: {
            packageJson: [],
            dependencyFiles: [],
            githubActions: [githubActionsFile],
          },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        // Should show both versions
        expect(result.body).toContain('actions/checkout v4')
        expect(result.body).toContain('actions/checkout v3')
      })
    })

    describe('package.json dependencies', () => {
      it('should group and display package.json dependencies by type', () => {
        const packageJsonFile: PackageFile = {
          path: 'package.json',
          type: 'package.json',
          content: 'package content',
          dependencies: [
            {
              name: 'react',
              currentVersion: '^18.0.0',
              type: 'dependencies',
              file: 'package.json',
            },
            {
              name: 'typescript',
              currentVersion: '^5.0.0',
              type: 'devDependencies',
              file: 'package.json',
            },
            {
              name: 'react-dom',
              currentVersion: '^18.0.0',
              type: 'peerDependencies',
              file: 'package.json',
            },
          ],
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [],
          detectedDependencies: {
            packageJson: [packageJsonFile],
            dependencyFiles: [],
            githubActions: [],
          },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        expect(result.body).toContain('<details><summary>npm</summary>')
        expect(result.body).toContain('<details><summary>package.json</summary>')
        expect(result.body).toContain('`react ^18.0.0`')
        expect(result.body).toContain('`typescript ^5.0.0`')
        expect(result.body).toContain('`react-dom ^18.0.0`')
      })
    })

    describe('dependency files', () => {
      it('should display dependency files with their dependencies', () => {
        const dependencyFile: PackageFile = {
          path: 'deps.yaml',
          type: 'deps.yaml',
          content: 'deps content',
          dependencies: [
            {
              name: 'bun.sh',
              currentVersion: '^1.2.16',
              type: 'dependencies',
              file: 'deps.yaml',
            },
            {
              name: 'ts-pkgx',
              currentVersion: '^0.4.4',
              type: 'dependencies',
              file: 'deps.yaml',
            },
          ],
        }

        const dashboardData: DashboardData = {
          repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
          openPRs: [],
          detectedDependencies: {
            packageJson: [],
            dependencyFiles: [dependencyFile],
            githubActions: [],
          },
          lastUpdated: new Date(),
        }

        const result = generator.generateDashboard(dashboardData)

        expect(result.body).toContain('<details><summary>dependency-files</summary>')
        expect(result.body).toContain('<details><summary>deps.yaml</summary>')
        expect(result.body).toContain('`bun.sh ^1.2.16`')
        expect(result.body).toContain('`ts-pkgx ^0.4.4`')
      })
    })
  })

  describe('template application', () => {
    it('should apply custom templates with variable replacement', () => {
      const customTemplate = `
# Custom Dashboard for {{repository.owner}}/{{repository.name}}

Open PRs: {{openPRs.count}}
Last Updated: {{lastUpdated}}

Package.json files: {{detectedDependencies.packageJson.count}}
GitHub Actions files: {{detectedDependencies.githubActions.count}}
Dependency files: {{detectedDependencies.dependencyFiles.count}}
`

      const dashboardData: DashboardData = {
        repository: { owner: 'test-owner', name: 'test-repo', provider: 'github' },
        openPRs: [
          {
            number: 123,
            title: 'Test PR',
            body: 'Test body',
            head: 'test-branch',
            base: 'main',
            state: 'open',
            url: 'https://github.com/test-owner/test-repo/pull/123',
            createdAt: new Date(),
            updatedAt: new Date(),
            author: 'buddy-bot',
            reviewers: [],
            assignees: [],
            labels: [],
            draft: false,
          },
        ],
        detectedDependencies: {
          packageJson: [{} as PackageFile, {} as PackageFile],
          dependencyFiles: [{} as PackageFile],
          githubActions: [],
        },
        lastUpdated: new Date('2024-01-01T00:00:00Z'),
      }

      const result = generator.generateDashboard(dashboardData, {
        bodyTemplate: customTemplate,
      })

      expect(result.body).toContain('test-owner/test-repo')
      expect(result.body).toContain('Open PRs: 1')
      expect(result.body).toContain('2024-01-01T00:00:00.000Z')
      expect(result.body).toContain('Package.json files: 2')
      expect(result.body).toContain('GitHub Actions files: 0')
      expect(result.body).toContain('Dependency files: 1')
    })
  })
})
