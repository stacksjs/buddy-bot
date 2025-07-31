import type { UpdateGroup } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'

describe('PR Body Generation for Major Updates', () => {
  const generator = new PullRequestGenerator()

  describe('single major update issue reproduction', () => {
    it('should generate complete PR body for major stripe update (original issue)', async () => {
      // This test reproduces the exact scenario from the user's issue
      const majorStripeUpdate: UpdateGroup = {
        name: 'Major Update - stripe',
        updateType: 'major',
        title: 'chore(deps): update dependency stripe to 18.4.0',
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

      const body = await generator.generateBody(majorStripeUpdate)

      // Should NOT be like the broken version:
      // | Type | Count |
      // |------|-------|
      // | **Total** | **1** |

      // simplified format for single package updates:
      // No summary table, no section header, just the npm badge and package table

      expect(body).not.toContain('## Package Updates Summary') // Simplified format
      expect(body).not.toContain('| 📦 NPM Packages | 1 |') // Simplified format
      expect(body).not.toContain('| **Total** | **1** |') // Simplified format

      // Should include the detailed package table (missing in original issue)
      expect(body).not.toContain('## 📦 npm Dependencies') // Simplified format
      expect(body).not.toContain('*1 package will be updated*') // Simplified format
      expect(body).toContain('![npm](https://img.shields.io/badge/npm-CB3837') // Should have npm badge
      expect(body).toContain('| Package | Change | Age | Adoption | Passing | Confidence |')

      // Should include package details
      expect(body).toContain('stripe')
      expect(body).toContain('17.7.0')
      expect(body).toContain('18.4.0')

      // Should include badges and links like Renovate
      expect(body).toContain('renovatebot.com/diffs/npm/stripe')
      expect(body).toContain('developer.mend.io/api/mc/badges')

      // Should have proper structure (not just empty Release Notes)
      expect(body).toContain('### Release Notes')
      expect(body).toContain('### Configuration')

      // Verify it's not the broken minimal version
      expect(body).not.toMatch(/^This PR contains the following updates:\s*## Package Updates Summary\s*\| Type \| Count \|\s*\|------\|-------\|\s*\| \*\*Total\*\* \| \*\*1\*\* \|\s*---\s*### Release Notes\s*---/)
    })

    it('should match Renovate-style format for major updates', async () => {
      const majorStripeUpdate: UpdateGroup = {
        name: 'Major Update - stripe',
        updateType: 'major',
        title: 'chore(deps): update dependency stripe to 18.4.0',
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

      const body = await generator.generateBody(majorStripeUpdate)

      // The format should be similar to Renovate's table:
      // | Package | Change | Age | Adoption | Passing | Confidence |
      // |---|---|---|---|---|---|
      // | [stripe](https://redirect.github.com/stripe/stripe-node) | [`^17.7.0` -> `^18.4.0`](https://renovatebot.com/diffs/npm/stripe/17.7.0/18.4.0) | badges... |

      // Check for Renovate-style package table
      const tableRegex = /\| Package \| Change \| Age \| Adoption \| Passing \| Confidence \|[\s\S]*?\| \[stripe\][^|]*\| [^|]*17\.7\.0[^|]*18\.4\.0[^|]*\|/
      expect(body).toMatch(tableRegex)

      // Should have package link
      expect(body).toMatch(/\[stripe\]\([^)]*github\.com[^)]*\)/)

      // Should have diff link
      expect(body).toMatch(/\[.*17\.7\.0.*18\.4\.0.*\]\([^)]*renovatebot\.com[^)]*\)/)

      // Should have badges
      expect(body).toMatch(/!\[age\]\([^)]*developer\.mend\.io[^)]*\)/)
      expect(body).toMatch(/!\[adoption\]\([^)]*developer\.mend\.io[^)]*\)/)
      expect(body).toMatch(/!\[passing\]\([^)]*developer\.mend\.io[^)]*\)/)
      expect(body).toMatch(/!\[confidence\]\([^)]*developer\.mend\.io[^)]*\)/)
    })

    it('should work for different major update types', async () => {
      // Test composer major update
      const majorComposerUpdate: UpdateGroup = {
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

      const composerBody = await generator.generateBody(majorComposerUpdate)

      // Composer single package updates should also use simplified format
      expect(composerBody).not.toContain('| 🐘 Composer Packages | 1 |') // No summary table
      expect(composerBody).not.toContain('## 🐘 PHP/Composer Dependencies') // No section header
      expect(composerBody).not.toContain('*1 package will be updated*') // No count text
      expect(composerBody).toContain('![composer](https://img.shields.io/badge/composer-885630') // Should have composer badge
      expect(composerBody).toContain('laravel/framework')

      // Test GitHub Action major update
      const majorActionUpdate: UpdateGroup = {
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

      const actionBody = await generator.generateBody(majorActionUpdate)

      // GitHub Actions single update should also use simplified format
      expect(actionBody).not.toContain('| 🚀 GitHub Actions | 1 |') // No summary table
      expect(actionBody).not.toContain('## 🚀 GitHub Actions') // No section header
      expect(actionBody).not.toContain('*1 action will be updated*') // No count text
      expect(actionBody).toContain('![github-actions](https://img.shields.io/badge/GitHub%20Actions-2088FF') // Should have GitHub Actions badge
      expect(actionBody).toContain('actions/checkout')
    })
  })
})
