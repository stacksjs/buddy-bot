import type { PackageFile } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { DeprecatedDependenciesChecker } from '../src/services/deprecated-dependencies-checker'

describe('DeprecatedDependenciesChecker', () => {
  const checker = new DeprecatedDependenciesChecker()
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  describe('checkDeprecatedDependencies', () => {
    it('should check for deprecated dependencies in package files', async () => {
      const mockPackageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{"dependencies": {"lodash": "^4.17.21"}}',
          dependencies: [
            {
              name: 'lodash',
              currentVersion: '^4.17.21',
              type: 'dependencies',
              file: 'package.json',
            },
          ],
        },
      ]

      // Mock the fetch to return a deprecated package
      fetchSpy.mockImplementation(async (url: string) => {
        if (url.includes('registry.npmjs.org/lodash')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              deprecated: 'This package is deprecated, use lodash-es instead',
              versions: {
                '4.17.21': {
                  deprecated: 'This version is deprecated, use lodash-es instead',
                },
              },
            }),
          } as any
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as any
      })

      const result = await checker.checkDeprecatedDependencies(mockPackageFiles)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('lodash')
      expect(result[0].datasource).toBe('npm')
      expect(result[0].replacementAvailable).toBe(false) // Default value
      expect(result[0].deprecationMessage).toContain('deprecated')
      expect(result[0].suggestedReplacement).toBe('lodash-es')
    })

    it('should handle non-deprecated packages', async () => {
      const mockPackageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{"dependencies": {"react": "^18.0.0"}}',
          dependencies: [
            {
              name: 'react',
              currentVersion: '^18.0.0',
              type: 'dependencies',
              file: 'package.json',
            },
          ],
        },
      ]

      // Mock the fetch to return a non-deprecated package
      fetchSpy.mockImplementation(async (url: string) => {
        if (url.includes('registry.npmjs.org/react')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              // No deprecated field
              versions: {
                '18.0.0': {
                  // No deprecated field
                },
              },
            }),
          } as any
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as any
      })

      const result = await checker.checkDeprecatedDependencies(mockPackageFiles)

      expect(result).toHaveLength(0)
    })

    it('should handle API errors gracefully', async () => {
      const mockPackageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{"dependencies": {"some-package": "^1.0.0"}}',
          dependencies: [
            {
              name: 'some-package',
              currentVersion: '^1.0.0',
              type: 'dependencies',
              file: 'package.json',
            },
          ],
        },
      ]

      // Mock the fetch to throw an error
      fetchSpy.mockImplementation(async () => {
        throw new Error('Network error')
      })

      const result = await checker.checkDeprecatedDependencies(mockPackageFiles)

      expect(result).toHaveLength(0)
    })
  })
})
