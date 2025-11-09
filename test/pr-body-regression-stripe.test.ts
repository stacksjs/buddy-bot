/* eslint-disable no-console */
import { beforeAll, describe, expect, it } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'

describe('PR Body Regression - Stripe Issue', () => {
  beforeAll(() => {
    process.env.APP_ENV = 'test'
  })

  it('should reproduce the exact stripe regression from PR #1453', async () => {
    // This test reproduces the exact regression where stripe major update
    // generates only summary table without detailed package information

    const config = {
      repository: {
        provider: 'github' as const,
        owner: 'stacksjs',
        name: 'stacks',
      },
    }

    const generator = new PullRequestGenerator(config)

    // Exact same data structure that would generate PR #1453
    const stripeUpdate = {
      name: 'Major Update - stripe',
      title: 'chore(deps): update dependency stripe to 18.4.0',
      body: '',
      updateType: 'major' as const,
      updates: [{
        name: 'stripe',
        currentVersion: '17.7.0',
        newVersion: '18.4.0',
        updateType: 'major' as const,
        dependencyType: 'dependencies' as const,
        file: 'package.json',
      }],
    }

    const body = await generator.generateBody(stripeUpdate)

    console.log('🔍 Generated PR body for regression test:')
    console.log('='.repeat(60))
    console.log(body)
    console.log('='.repeat(60))

    // The regression: PR body should NOT be sparse like PR #1453
    // It should include the detailed NPM table with badges and links
    // NOTE: Single package updates now have a simplified format without summary table

    // 1. Should NOT have package summary table for single package updates (new simplified format)
    expect(body).not.toContain('## Package Updates Summary')
    expect(body).not.toContain('| 📦 NPM Packages | 1 |')
    expect(body).not.toContain('| **Total** | **1** |')

    // 2. Should NOT have npm section header for single package updates (new simplified format)
    expect(body).not.toContain('## 📦 npm Dependencies')

    // 3. CRITICAL: Should have npm badge and detailed package table (this was missing in #1453)
    expect(body).toContain('![npm](https://img.shields.io/badge/npm-CB3837?style=flat&logo=npm&logoColor=white)')

    // Should NOT have package count text for single packages (new simplified format)
    expect(body).not.toContain('*1 package will be updated*')

    // 3. Should have detailed package table with badges (missing in #1453)
    expect(body).toContain('| Package | Change | Age | Adoption | Passing | Confidence |')
    expect(body).toContain('stripe')
    expect(body).toContain('17.7.0')
    expect(body).toContain('18.4.0')
    expect(body).toContain('developer.mend.io/api/mc/badges') // Confidence badges
    expect(body).toContain('renovatebot.com/diffs/npm/stripe') // Diff link

    // 4. Should have release notes section (missing in #1453)
    expect(body).toContain('### Release Notes')
    expect(body).toContain('<details>')
    expect(body).toContain('stripe/stripe-node')

    // 5. Should have package statistics (missing in #1453)
    expect(body).toContain('### 📊 Package Statistics')
    expect(body).toContain('weekly downloads')

    // 6. Should NOT be the broken minimal version from PR #1453
    expect(body).not.toMatch(/^This PR contains the following updates:\s*## Package Updates Summary\s*\| Type \| Count \|\s*\|------\|-------\|\s*\| \*\*Total\*\* \| \*\*1\*\* \|\s*---\s*### Release Notes\s*---/)

    // 7. Body should be substantial, not sparse like PR #1453 (which was ~500 chars)
    expect(body.length).toBeGreaterThan(2000) // Should have substantial content

    console.log(`✅ PR body length: ${body.length} characters (should be > 2000)`)
    console.log(`✅ Has detailed package table: ${body.includes('| Package | Change | Age |')}`)
    console.log(`✅ Has badges: ${body.includes('developer.mend.io')}`)
    console.log(`✅ Has release notes: ${body.includes('<details>')}`)
  })

  it('should handle different file path formats correctly', async () => {
    // This test ensures we handle various file path formats that might come from the runtime

    const config = {
      repository: {
        provider: 'github' as const,
        owner: 'stacksjs',
        name: 'stacks',
      },
    }

    const generator = new PullRequestGenerator(config)

    // Test relative path (likely cause of PR #1453 regression)
    const relativePathUpdate = {
      name: 'Major Update - stripe',
      title: 'chore(deps): update dependency stripe to 18.4.0',
      body: '',
      updateType: 'major' as const,
      updates: [{
        name: 'stripe',
        currentVersion: '17.7.0',
        newVersion: '18.4.0',
        updateType: 'major' as const,
        dependencyType: 'dependencies' as const,
        file: './package.json', // This was likely the issue in PR #1453
      }],
    }

    const body = await generator.generateBody(relativePathUpdate)

    // Should work correctly with relative path (new simplified format)
    expect(body).not.toContain('| 📦 NPM Packages | 1 |') // No summary table for single packages
    expect(body).not.toContain('## 📦 npm Dependencies') // No section header for single packages
    expect(body).toContain('| Package | Change | Age | Adoption | Passing | Confidence |') // Should have detailed table
    expect(body).toContain('![npm](https://img.shields.io/badge/npm-CB3837') // Should have npm badge
    expect(body.length).toBeGreaterThan(2000)

    // Test absolute path (common in CI environments)
    const absolutePathUpdate = {
      name: 'Major Update - stripe',
      title: 'chore(deps): update dependency stripe to 18.4.0',
      body: '',
      updateType: 'major' as const,
      updates: [{
        name: 'stripe',
        currentVersion: '17.7.0',
        newVersion: '18.4.0',
        updateType: 'major' as const,
        dependencyType: 'dependencies' as const,
        file: '/home/runner/work/stacks/stacks/package.json', // CI environment path
      }],
    }

    const bodyAbsolute = await generator.generateBody(absolutePathUpdate)

    // Should work correctly with absolute path (new simplified format)
    expect(bodyAbsolute).not.toContain('| 📦 NPM Packages | 1 |') // No summary table for single packages
    expect(bodyAbsolute).not.toContain('## 📦 npm Dependencies') // No section header for single packages
    expect(bodyAbsolute).toContain('| Package | Change | Age | Adoption | Passing | Confidence |') // Should have detailed table
    expect(bodyAbsolute).toContain('![npm](https://img.shields.io/badge/npm-CB3837') // Should have npm badge
    expect(bodyAbsolute.length).toBeGreaterThan(2000)
  })

  it('should verify the minimal broken format does NOT match our output', async () => {
    // This test ensures we don't regress back to the broken format from PR #1453

    const config = {
      repository: {
        provider: 'github' as const,
        owner: 'stacksjs',
        name: 'stacks',
      },
    }

    const generator = new PullRequestGenerator(config)

    const stripeUpdate = {
      name: 'Major Update - stripe',
      title: 'chore(deps): update dependency stripe to 18.4.0',
      body: '',
      updateType: 'major' as const,
      updates: [{
        name: 'stripe',
        currentVersion: '17.7.0',
        newVersion: '18.4.0',
        updateType: 'major' as const,
        dependencyType: 'dependencies' as const,
        file: 'package.json',
      }],
    }

    const body = await generator.generateBody(stripeUpdate)

    // The broken pattern from PR #1453 (minimal content without detailed table)
    const brokenPattern = `This PR contains the following updates:

## Package Updates Summary

| Type | Count |
|------|-------|
| **Total** | **1** |


---

### Release Notes

---`

    // Our output should NOT match this broken minimal pattern
    expect(body).not.toContain(brokenPattern)

    // For single package updates, we now have a simplified format
    // Check that we have substantial content before release notes
    const beforeReleaseNotes = body.substring(0, body.indexOf('### Release Notes'))

    // Should have the npm badge and package table (the key content that was missing in #1453)
    expect(beforeReleaseNotes).toContain('![npm](https://img.shields.io/badge/npm-CB3837')
    expect(beforeReleaseNotes).toContain('| Package | Change | Age | Adoption | Passing | Confidence |')
    expect(beforeReleaseNotes).toContain('stripe')
    expect(beforeReleaseNotes.length).toBeGreaterThan(500) // Should have substantial content
  })
})
