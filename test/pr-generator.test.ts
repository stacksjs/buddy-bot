import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { PullRequestGenerator } from '../src/pr/pr-generator'
import type { UpdateGroup, PackageUpdate } from '../src/types'

describe('PullRequestGenerator', () => {
  let generator: PullRequestGenerator

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
  })

      describe('generateBody', () => {
    it('should have generateBody method', () => {
      expect(typeof generator.generateBody).toBe('function')
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
          metadata: undefined
        }]
      }

      expect(updateWithoutMetadata.updates[0].metadata).toBeUndefined()
      expect(generator.generateTitle(updateWithoutMetadata)).toBeDefined()
    })
  })
})
