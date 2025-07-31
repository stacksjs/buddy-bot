import type { PackageUpdate, UpdateGroup } from '../src/types'
import { beforeAll, describe, expect, it } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'

describe('PullRequestGenerator', () => {
  let generator: PullRequestGenerator

  const mockPackageUpdate: PackageUpdate = {
    name: 'typescript',
    currentVersion: '5.8.2',
    newVersion: '5.8.3',
    updateType: 'patch',
    dependencyType: 'devDependencies',
    file: 'package.json',
    metadata: undefined,
  }

  const mockUpdateGroup: UpdateGroup = {
    name: 'Patch Updates',
    updateType: 'patch',
    title: 'chore(deps): update typescript to v5.8.3',
    body: '',
    updates: [mockPackageUpdate],
  }

  beforeAll(() => {
    process.env.APP_ENV = 'test'
    generator = new PullRequestGenerator()
  })

  describe('generateTitle', () => {
    it('should generate title for single package update', () => {
      const title = generator.generateTitle(mockUpdateGroup)
      expect(title).toBe('chore(deps): update dependency typescript to v5.8.3')
    })

    it('should generate title for multiple package updates', () => {
      const multipleUpdateGroup: UpdateGroup = {
        name: 'Multiple Updates',
        updateType: 'minor',
        title: '',
        body: '',
        updates: [
          mockPackageUpdate,
          { ...mockPackageUpdate, name: 'react', updateType: 'minor' },
        ],
      }

      const title = generator.generateTitle(multipleUpdateGroup)
      expect(title).toBe('chore(deps): update 2 dependencies (minor)')
    })

    it('should prioritize major updates in title', () => {
      const majorUpdateGroup: UpdateGroup = {
        name: 'Mixed Updates',
        updateType: 'major',
        title: '',
        body: '',
        updates: [
          mockPackageUpdate, // patch
          { ...mockPackageUpdate, name: 'react', updateType: 'major' },
          { ...mockPackageUpdate, name: 'vue', updateType: 'minor' },
        ],
      }

      const title = generator.generateTitle(majorUpdateGroup)
      expect(title).toBe('chore(deps): update 3 dependencies (major)')
    })
  })

  describe('generateBody', () => {
    it('should have generateBody method', () => {
      expect(typeof generator.generateBody).toBe('function')
    })

    describe('single package update', () => {
      it('should include package summary table for single npm package', async () => {
        const singleNpmUpdate: UpdateGroup = {
          name: 'Major Update - stripe',
          updateType: 'major',
          title: 'chore(deps): update dependency stripe to v18.4.0',
          body: '',
          updates: [{
            name: 'stripe',
            currentVersion: '17.7.0',
            newVersion: '18.4.0',
            updateType: 'major',
            dependencyType: 'dependencies',
            file: 'package.json',
            metadata: undefined,
          }],
        }

        const body = await generator.generateBody(singleNpmUpdate)

        // Single package updates use simplified format - no summary table
        expect(body).not.toContain('## Package Updates Summary')
        expect(body).not.toContain('| Type | Count |')
        expect(body).not.toContain('| 📦 NPM Packages | 1 |')
        expect(body).not.toContain('| **Total** | **1** |')
      })

      it('should include detailed npm dependencies table for single package', async () => {
        const singleNpmUpdate: UpdateGroup = {
          name: 'Major Update - stripe',
          updateType: 'major',
          title: 'chore(deps): update dependency stripe to v18.4.0',
          body: '',
          updates: [{
            name: 'stripe',
            currentVersion: '17.7.0',
            newVersion: '18.4.0',
            updateType: 'major',
            dependencyType: 'dependencies',
            file: 'package.json',
            metadata: undefined,
          }],
        }

        const body = await generator.generateBody(singleNpmUpdate)

        // Single package updates use simplified format - no section header
        expect(body).not.toContain('## 📦 npm Dependencies')
        expect(body).toContain('![npm](https://img.shields.io/badge/npm-CB3837?style=flat&logo=npm&logoColor=white)')
        // Single package updates don't show count text
        expect(body).not.toContain('*1 package will be updated*')
        expect(body).toContain('| Package | Change | Age | Adoption | Passing | Confidence |')
        expect(body).toContain('stripe')
        expect(body).toContain('17.7.0')
        expect(body).toContain('18.4.0')
      })

      it('should include badges and links for single npm package', async () => {
        const singleNpmUpdate: UpdateGroup = {
          name: 'Major Update - stripe',
          updateType: 'major',
          title: 'chore(deps): update dependency stripe to v18.4.0',
          body: '',
          updates: [{
            name: 'stripe',
            currentVersion: '17.7.0',
            newVersion: '18.4.0',
            updateType: 'major',
            dependencyType: 'dependencies',
            file: 'package.json',
            metadata: undefined,
          }],
        }

        const body = await generator.generateBody(singleNpmUpdate)

        // Should include badges and links
        expect(body).toContain('renovatebot.com/diffs/npm/stripe')
        expect(body).toContain('developer.mend.io/api/mc/badges')
        expect(body).toMatch(/\[.*stripe.*\]\(.*github\.com.*\)/) // Package link
      })

      it('should include configuration section for single package', async () => {
        const singleNpmUpdate: UpdateGroup = {
          name: 'Major Update - stripe',
          updateType: 'major',
          title: 'chore(deps): update dependency stripe to v18.4.0',
          body: '',
          updates: [{
            name: 'stripe',
            currentVersion: '17.7.0',
            newVersion: '18.4.0',
            updateType: 'major',
            dependencyType: 'dependencies',
            file: 'package.json',
            metadata: undefined,
          }],
        }

        const body = await generator.generateBody(singleNpmUpdate)

        // Should include configuration section
        expect(body).toContain('### Configuration')
        expect(body).toContain('📅 **Schedule**')
        expect(body).toContain('🚦 **Automerge**')
        expect(body).toContain('♻ **Rebasing**')
        expect(body).toContain('🔕 **Ignore**')
        expect(body).toContain('rebase-check')
        expect(body).toContain('This PR was generated by [Buddy](https://github.com/stacksjs/buddy-bot) 🤖')
      })
    })

    describe('single composer package update', () => {
      it('should include composer package summary and details', async () => {
        const singleComposerUpdate: UpdateGroup = {
          name: 'Major Update - laravel/framework',
          updateType: 'major',
          title: 'chore(deps): update dependency laravel/framework to v11.0.0',
          body: '',
          updates: [{
            name: 'laravel/framework',
            currentVersion: '10.48.0',
            newVersion: '11.0.0',
            updateType: 'major',
            dependencyType: 'require',
            file: 'composer.json',
            metadata: undefined,
          }],
        }

        const body = await generator.generateBody(singleComposerUpdate)

        // Single package updates use simplified format - no summary table or section header
        expect(body).not.toContain('## Package Updates Summary')
        expect(body).not.toContain('| 🐘 Composer Packages | 1 |')

        // Single package updates use simplified format - no section header
        expect(body).not.toContain('## 🐘 PHP/Composer Dependencies')
        expect(body).toContain('![composer](https://img.shields.io/badge/composer-885630?style=flat&logo=composer&logoColor=white)')
        // Single package updates don't show count text
        expect(body).not.toContain('*1 package will be updated*')
        expect(body).toContain('| Package | Change | Age | Adoption | Passing | Confidence | Type | Update |')
        expect(body).toContain('laravel/framework')
      })
    })

    describe('single system dependency update', () => {
      it('should include system dependency summary and details', async () => {
        const singleSystemUpdate: UpdateGroup = {
          name: 'Major Update - node.js',
          updateType: 'major',
          title: 'chore(deps): update dependency node.js to v22.0.0',
          body: '',
          updates: [{
            name: 'nodejs.org',
            currentVersion: '20.12.0',
            newVersion: '22.0.0',
            updateType: 'major',
            dependencyType: 'dependencies',
            file: 'deps.yaml',
            metadata: undefined,
          }],
        }

        const body = await generator.generateBody(singleSystemUpdate)

        // Single package updates use simplified format - no summary table or section header
        expect(body).not.toContain('## Package Updates Summary')
        expect(body).not.toContain('| 🔧 System Dependencies | 1 |')

        // Single package updates use simplified format - no section header
        expect(body).not.toContain('## 🔧 System Dependencies')
        expect(body).toContain('![system](https://img.shields.io/badge/system-4CAF50?style=flat&logo=linux&logoColor=white)')
        // Single package updates don't show count text
        expect(body).not.toContain('*1 package will be updated in `deps.yaml`*')
        expect(body).toContain('| Package | Change | Type | File |')
      })
    })

    describe('single github action update', () => {
      it('should include github action summary and details', async () => {
        const singleActionUpdate: UpdateGroup = {
          name: 'Major Update - actions/checkout',
          updateType: 'major',
          title: 'chore(deps): update dependency actions/checkout to v5',
          body: '',
          updates: [{
            name: 'actions/checkout',
            currentVersion: 'v4',
            newVersion: 'v5',
            updateType: 'major',
            dependencyType: 'github-actions',
            file: '.github/workflows/ci.yml',
            metadata: undefined,
          }],
        }

        const body = await generator.generateBody(singleActionUpdate)

        // Single package updates use simplified format - no summary table or section header
        expect(body).not.toContain('## Package Updates Summary')
        expect(body).not.toContain('| 🚀 GitHub Actions | 1 |')

        // Single package updates use simplified format - no section header
        expect(body).not.toContain('## 🚀 GitHub Actions')
        expect(body).toContain('![github-actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat&logo=github-actions&logoColor=white)')
        // Single package updates don't show count text
        expect(body).not.toContain('*1 action will be updated*')
        expect(body).toContain('| Action | Change | Type | Files |')
        expect(body).toContain('actions/checkout')
      })
    })

    describe('empty or no package type updates', () => {
      it('should not include missing package type rows in summary table', async () => {
        const npmOnlyUpdate: UpdateGroup = {
          name: 'NPM Only Update',
          updateType: 'patch',
          title: 'chore(deps): update dependency react to v18.3.1',
          body: '',
          updates: [{
            name: 'react',
            currentVersion: '18.3.0',
            newVersion: '18.3.1',
            updateType: 'patch',
            dependencyType: 'dependencies',
            file: 'package.json',
            metadata: undefined,
          }],
        }

        const body = await generator.generateBody(npmOnlyUpdate)

        // Single package updates use simplified format - no summary table
        expect(body).not.toContain('| 📦 NPM Packages | 1 |')
        expect(body).not.toContain('| 🔧 System Dependencies |')
        expect(body).not.toContain('| 🚀 GitHub Actions |')
        expect(body).not.toContain('| 🎼 Composer Packages |')
      })
    })

    describe('body structure and format', () => {
      it('should have correct overall structure for single package update', async () => {
        const body = await generator.generateBody(mockUpdateGroup)

        // Check that key sections exist in the right order (simplified format for single packages)
        const introIndex = body.indexOf('This PR contains the following updates:')
        const npmBadgeIndex = body.indexOf('![npm](https://img.shields.io/badge/npm-CB3837')
        const packageTableIndex = body.indexOf('| Package | Change | Age | Adoption | Passing | Confidence |')
        const releaseNotesIndex = body.indexOf('### Release Notes')
        const configIndex = body.indexOf('### Configuration')
        const footerIndex = body.indexOf('This PR was generated by [Buddy](https://github.com/stacksjs/buddy-bot) 🤖')

        // Verify all sections exist
        expect(introIndex).toBeGreaterThanOrEqual(0)
        expect(npmBadgeIndex).toBeGreaterThanOrEqual(0)
        expect(packageTableIndex).toBeGreaterThanOrEqual(0)
        expect(releaseNotesIndex).toBeGreaterThanOrEqual(0)
        expect(configIndex).toBeGreaterThanOrEqual(0)
        expect(footerIndex).toBeGreaterThanOrEqual(0)

        // Verify single packages don't have summary table or section headers
        expect(body).not.toContain('## Package Updates Summary')
        expect(body).not.toContain('## 📦 npm Dependencies')

        // Verify correct order for simplified format
        expect(npmBadgeIndex).toBeGreaterThan(introIndex)
        expect(packageTableIndex).toBeGreaterThan(npmBadgeIndex)
        expect(releaseNotesIndex).toBeGreaterThan(packageTableIndex)
        expect(configIndex).toBeGreaterThan(releaseNotesIndex)
        expect(footerIndex).toBeGreaterThan(configIndex)
      })

      it('should not exceed GitHub PR body character limit', async () => {
        const body = await generator.generateBody(mockUpdateGroup)

        // GitHub's limit is 65,536 characters, but we use 60,000 as buffer
        expect(body.length).toBeLessThan(60000)
      })
    })
  })

  describe('generateCustomTemplate', () => {
    it('should replace template variables', () => {
      const template = 'Update {package_count} packages on {date}'
      const result = generator.generateCustomTemplate(mockUpdateGroup, template)

      expect(result).toContain('Update 1 packages')
      expect(result).toContain('on 20') // Should contain current year
    })

    it('should handle custom variables', () => {
      const template = 'Project: {project} - Updates: {package_count}'
      const variables = { '{project}': 'my-app' }
      const result = generator.generateCustomTemplate(mockUpdateGroup, template, variables)

      expect(result).toContain('Project: my-app')
      expect(result).toContain('Updates: 1')
    })

    it('should replace title variable', () => {
      const template = 'Title: {title}'
      const result = generator.generateCustomTemplate(mockUpdateGroup, template)

      expect(result).toContain('Title: chore(deps): update dependency typescript to v5.8.3')
    })
  })

  describe('generatePullRequests', () => {
    it('should have generatePullRequests method', () => {
      expect(typeof generator.generatePullRequests).toBe('function')
    })
  })

  describe('helper methods', () => {
    it('should have required helper methods', () => {
      expect(typeof generator.generateBody).toBe('function')
      expect(typeof generator.generateTitle).toBe('function')
      expect(typeof generator.generateCustomTemplate).toBe('function')
    })
  })

  describe('error handling', () => {
    it('should handle undefined metadata', () => {
      const updateWithoutMetadata: UpdateGroup = {
        ...mockUpdateGroup,
        updates: [{
          ...mockPackageUpdate,
          metadata: undefined,
        }],
      }

      expect(updateWithoutMetadata.updates[0].metadata).toBeUndefined()
      expect(generator.generateTitle(updateWithoutMetadata)).toBeDefined()
    })
  })
})
