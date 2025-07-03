import { describe, expect, it } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'
import type { UpdateGroup, PackageUpdate } from '../src/types'

describe('PR Generator - Simple Tests', () => {
  const generator = new PullRequestGenerator()

  const mockPackageUpdate: PackageUpdate = {
    name: 'typescript',
    currentVersion: '5.8.2',
    newVersion: '5.8.3',
    updateType: 'patch',
    dependencyType: 'devDependencies',
    file: 'package.json',
    metadata: undefined
  }

  const mockUpdateGroup: UpdateGroup = {
    name: 'Patch Updates',
    updateType: 'patch',
    title: 'chore(deps): update typescript to v5.8.3',
    body: '',
    updates: [mockPackageUpdate]
  }

  describe('Title Generation', () => {
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
          { ...mockPackageUpdate, name: 'react', updateType: 'minor' }
        ]
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
          { ...mockPackageUpdate, name: 'vue', updateType: 'minor' }
        ]
      }

      const title = generator.generateTitle(majorUpdateGroup)
      expect(title).toBe('chore(deps): update 3 dependencies (major)')
    })

    it('should handle empty update groups', () => {
      const emptyGroup: UpdateGroup = {
        name: 'Empty',
        updateType: 'patch',
        title: '',
        body: '',
        updates: []
      }

      const title = generator.generateTitle(emptyGroup)
      expect(title).toBe('chore(deps): update 0 dependencies (patch)')
    })
  })

  describe('Template Generation', () => {
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

    it('should handle multiple replacements', () => {
      const template = '{package_count} updates of type {update_type} on {date}'
      const result = generator.generateCustomTemplate(mockUpdateGroup, template)

      expect(result).toContain('1 updates')
      expect(result).toContain('of type patch')
      expect(result).toContain('on 20')
    })
  })

  describe('Package Information', () => {
    it('should extract package names correctly', () => {
      const multiPackageGroup: UpdateGroup = {
        name: 'Multi Package',
        updateType: 'minor',
        title: '',
        body: '',
        updates: [
          mockPackageUpdate,
          { ...mockPackageUpdate, name: '@types/node' },
          { ...mockPackageUpdate, name: '@vue/cli' }
        ]
      }

      const title = generator.generateTitle(multiPackageGroup)
      expect(title).toContain('3 dependencies')
    })

    it('should handle scoped package names', () => {
      const scopedUpdate: UpdateGroup = {
        name: 'Scoped Package',
        updateType: 'patch',
        title: '',
        body: '',
        updates: [{
          ...mockPackageUpdate,
          name: '@types/node'
        }]
      }

      const title = generator.generateTitle(scopedUpdate)
      expect(title).toBe('chore(deps): update dependency @types/node to v5.8.3')
    })
  })

  describe('Update Type Handling', () => {
    it('should handle major updates', () => {
      const majorGroup: UpdateGroup = {
        name: 'Major Update',
        updateType: 'major',
        title: '',
        body: '',
        updates: [{ ...mockPackageUpdate, updateType: 'major' }]
      }

      const title = generator.generateTitle(majorGroup)
      expect(title).toContain('typescript')
      expect(title).toContain('5.8.3')
    })

    it('should handle minor updates', () => {
      const minorGroup: UpdateGroup = {
        name: 'Minor Update',
        updateType: 'minor',
        title: '',
        body: '',
        updates: [{ ...mockPackageUpdate, updateType: 'minor' }]
      }

      const title = generator.generateTitle(minorGroup)
      expect(title).toContain('typescript')
      expect(title).toContain('5.8.3')
    })

    it('should handle patch updates', () => {
      const title = generator.generateTitle(mockUpdateGroup)
      // Patch updates might not show (patch) suffix as it's the default
      expect(title).toBeDefined()
      expect(title.length).toBeGreaterThan(0)
    })
  })

  describe('Version Formatting', () => {
    it('should format single version correctly', () => {
      const title = generator.generateTitle(mockUpdateGroup)
      expect(title).toContain('to v5.8.3')
    })

    it('should handle different version formats', () => {
      const semverUpdate: UpdateGroup = {
        name: 'Semver Update',
        updateType: 'major',
        title: '',
        body: '',
        updates: [{
          ...mockPackageUpdate,
          currentVersion: '1.0.0',
          newVersion: '2.0.0'
        }]
      }

      const title = generator.generateTitle(semverUpdate)
      expect(title).toContain('to v2.0.0')
    })
  })

  describe('Edge Cases', () => {
    it('should handle very long package names', () => {
      const longNameUpdate: UpdateGroup = {
        name: 'Long Name',
        updateType: 'patch',
        title: '',
        body: '',
        updates: [{
          ...mockPackageUpdate,
          name: 'very-long-package-name-that-exceeds-normal-length'
        }]
      }

      const title = generator.generateTitle(longNameUpdate)
      expect(title).toContain('very-long-package-name-that-exceeds-normal-length')
    })

    it('should handle special characters in package names', () => {
      const specialCharUpdate: UpdateGroup = {
        name: 'Special Chars',
        updateType: 'patch',
        title: '',
        body: '',
        updates: [{
          ...mockPackageUpdate,
          name: '@org/package-name_with.special-chars'
        }]
      }

      const title = generator.generateTitle(specialCharUpdate)
      expect(title).toContain('@org/package-name_with.special-chars')
    })
  })
})
