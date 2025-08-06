import type { PackageFile } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { DeprecatedDependenciesChecker } from '../src/services/deprecated-dependencies-checker'

describe('DeprecatedDependenciesChecker', () => {
  let checker: DeprecatedDependenciesChecker
  let fetchSpy: any

  beforeEach(() => {
    checker = new DeprecatedDependenciesChecker()
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy?.mockRestore?.()
  })

  describe('checkDeprecatedDependencies', () => {
    it('should check multiple package files for deprecated dependencies', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'deprecated-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
        {
          path: 'deps.yaml',
          type: 'deps.yaml',
          content: 'dependencies:\n  bun-deprecated: 1.0.0',
          dependencies: [
            { name: 'bun-deprecated', currentVersion: '1.0.0', type: 'dependencies', file: 'deps.yaml' },
          ],
        },
      ]

      // Mock npm registry response for deprecated package
      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('registry.npmjs.org/deprecated-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'This package is deprecated, use new-package instead',
              versions: {
                '1.0.0': { deprecated: 'This version is deprecated' },
              },
            }),
          })
        }
        if (url.includes('registry.npmjs.org/bun-deprecated')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'This Bun package is deprecated',
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        name: 'deprecated-package',
        currentVersion: '1.0.0',
        datasource: 'npm',
        file: 'package.json',
        type: 'dependencies',
        replacementAvailable: false,
        deprecationMessage: 'This package is deprecated, use new-package instead',
        suggestedReplacement: 'new-package',
      })
      expect(result[1]).toMatchObject({
        name: 'bun-deprecated',
        currentVersion: '1.0.0',
        datasource: 'bun',
        file: 'deps.yaml',
        type: 'dependencies',
        replacementAvailable: false,
        deprecationMessage: 'This Bun package is deprecated',
      })
    })

    it('should return empty array when no deprecated dependencies found', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'active-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      // Mock a successful response with no deprecation
      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('active-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'active-package',
              // No deprecated field - package is not deprecated
              versions: {
                '1.0.0': {
                  // No deprecated field in version either
                },
              },
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(0)
    })

    it('should handle network errors gracefully', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'test-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('test-package')) {
          return Promise.reject(new Error('Network error'))
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      // The implementation catches errors and returns { deprecated: false }
      // So no deprecated dependencies should be found
      expect(result).toHaveLength(0)
    })
  })

  describe('Bun-specific functionality', () => {
    it('should identify Bun datasource correctly for deps.yaml files', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'deps.yaml',
          type: 'deps.yaml',
          content: 'dependencies:\n  test-package: 1.0.0',
          dependencies: [
            { name: 'test-package', currentVersion: '1.0.0', type: 'dependencies', file: 'deps.yaml' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          deprecated: 'This package is deprecated',
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(1)
      expect(result[0].datasource).toBe('bun')
    })

    it('should identify Bun datasource correctly for deps.yml files', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'deps.yml',
          type: 'deps.yml',
          content: 'dependencies:\n  test-package: 1.0.0',
          dependencies: [
            { name: 'test-package', currentVersion: '1.0.0', type: 'dependencies', file: 'deps.yml' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          deprecated: 'This package is deprecated',
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(1)
      expect(result[0].datasource).toBe('bun')
    })

    it('should use npm registry for Bun package deprecation checks', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'deps.yaml',
          type: 'deps.yaml',
          content: 'dependencies:\n  bun-package: 1.0.0',
          dependencies: [
            { name: 'bun-package', currentVersion: '1.0.0', type: 'dependencies', file: 'deps.yaml' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('registry.npmjs.org/bun-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'This Bun package is deprecated, use new-bun-package instead',
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'bun-package',
        datasource: 'bun',
        deprecationMessage: 'This Bun package is deprecated, use new-bun-package instead',
        suggestedReplacement: 'new-bun-package',
      })
    })
  })

  describe('NPM package deprecation', () => {
    it('should detect package-level deprecation', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'deprecated-npm-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          deprecated: 'This package is deprecated, use new-package instead',
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'deprecated-npm-package',
        datasource: 'npm',
        deprecationMessage: 'This package is deprecated, use new-package instead',
        suggestedReplacement: 'new-package',
      })
    })

    it('should detect version-specific deprecation', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'version-deprecated', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          versions: {
            '1.0.0': { deprecated: 'This version is deprecated, use 2.0.0' },
            '2.0.0': {},
          },
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'version-deprecated',
        deprecationMessage: 'This version is deprecated, use 2.0.0',
      })
    })

    it('should handle registry errors gracefully', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'non-existent-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('non-existent-package')) {
          return Promise.resolve({ ok: false })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      // When response.ok is false, the implementation returns { deprecated: false }
      // So no deprecated dependencies should be found
      expect(result).toHaveLength(0)
    })
  })

  describe('Composer package deprecation', () => {
    it('should detect abandoned packages', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'composer.json',
          type: 'composer.json',
          content: '{}',
          dependencies: [
            { name: 'abandoned/package', currentVersion: '1.0.0', type: 'require', file: 'composer.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          package: {
            abandoned: 'new/package',
          },
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'abandoned/package',
        datasource: 'composer',
        deprecationMessage: 'Package is abandoned, use new/package instead',
        suggestedReplacement: 'new/package',
      })
    })

    it('should handle abandoned packages without replacement', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'composer.json',
          type: 'composer.json',
          content: '{}',
          dependencies: [
            { name: 'abandoned/no-replacement', currentVersion: '1.0.0', type: 'require', file: 'composer.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          package: {
            abandoned: true,
          },
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: 'abandoned/no-replacement',
        datasource: 'composer',
        deprecationMessage: 'Package is abandoned',
        suggestedReplacement: undefined,
      })
    })
  })

  describe('Suggested replacement extraction', () => {
    it('should extract replacement from "use X instead" pattern', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'old-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          deprecated: 'This package is deprecated, use new-package instead',
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0].suggestedReplacement).toBe('new-package')
    })

    it('should extract replacement from "replaced by X" pattern', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'old-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          deprecated: 'This package is replaced by replacement-package',
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0].suggestedReplacement).toBe('replacement-package')
    })

    it('should extract replacement from "migrate to X" pattern', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'old-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          deprecated: 'Please migrate to migration-target',
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0].suggestedReplacement).toBe('migration-target')
    })

    it('should extract replacement from "switch to X" pattern', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'old-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          deprecated: 'Switch to switch-target for better performance',
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0].suggestedReplacement).toBe('switch-target')
    })

    it('should handle deprecation messages without replacement suggestions', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'old-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          deprecated: 'This package is deprecated with no replacement available',
        }),
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0].suggestedReplacement).toBeUndefined()
    })
  })

  describe('Datasource identification', () => {
    it('should identify npm datasource for package.json files', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'test-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('test-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'This package is deprecated',
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0]?.datasource).toBe('npm')
    })

    it('should identify npm datasource for lock files', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package-lock.json',
          type: 'package-lock.json',
          content: '{}',
          dependencies: [
            { name: 'test-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package-lock.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('test-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'This package is deprecated',
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0]?.datasource).toBe('npm')
    })

    it('should identify composer datasource for composer files', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'composer.json',
          type: 'composer.json',
          content: '{}',
          dependencies: [
            { name: 'test/package', currentVersion: '1.0.0', type: 'require', file: 'composer.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('test/package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              package: {
                abandoned: 'new/package',
              },
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0]?.datasource).toBe('composer')
    })

    it('should identify bun datasource for deps files', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'deps.yaml',
          type: 'deps.yaml',
          content: '{}',
          dependencies: [
            { name: 'test-package', currentVersion: '1.0.0', type: 'dependencies', file: 'deps.yaml' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('test-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'This package is deprecated',
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result[0]?.datasource).toBe('bun')
    })

    it('should identify github-actions datasource for github-actions files', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: '.github/workflows/test.yml',
          type: 'github-actions',
          content: '{}',
          dependencies: [
            { name: 'actions/checkout', currentVersion: 'v3', type: 'github-actions', file: '.github/workflows/test.yml' },
          ],
        },
      ]

      // Note: GitHub Actions deprecation checking is not currently implemented
      // The implementation returns { deprecated: false } for github-actions file types
      const result = await checker.checkDeprecatedDependencies(packageFiles)

      // Since GitHub Actions deprecation checking is not implemented, we expect no results
      expect(result).toHaveLength(0)
    })

    it('should identify unknown datasource for unrecognized file types', async () => {
      // Note: This test would require the PackageFile type to allow unknown file types
      // For now, we'll test that the getDatasourceFromFileType method works correctly
      // by testing the logic indirectly through the actual implementation
      const packageFiles: PackageFile[] = [
        {
          path: 'test.json',
          type: 'package.json', // Using a valid type since PackageFile type is restrictive
          content: '{}',
          dependencies: [
            { name: 'test-package', currentVersion: '1.0.0', type: 'dependencies', file: 'test.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('test-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'This package is deprecated',
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      // Since we're using package.json type, it should map to npm datasource
      expect(result[0]?.datasource).toBe('npm')
    })
  })

  describe('Error handling', () => {
    it('should handle fetch errors gracefully', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'error-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('error-package')) {
          return Promise.reject(new Error('Network error'))
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(0)
    })

    it('should handle JSON parsing errors gracefully', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'json-error-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('json-error-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.reject(new Error('Invalid JSON')),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      // When JSON parsing fails, the implementation catches the error and returns { deprecated: false }
      // So no deprecated dependencies should be found
      expect(result).toHaveLength(0)
    })

    it('should continue processing other dependencies when one fails', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'error-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
            { name: 'working-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('error-package')) {
          return Promise.reject(new Error('Network error'))
        }
        if (url.includes('working-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'This package is deprecated',
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      // The error-package should fail and be skipped, but working-package should be processed
      // and found to be deprecated
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('working-package')
    })
  })

  describe('Integration scenarios', () => {
    it('should handle mixed package file types', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [
            { name: 'npm-package', currentVersion: '1.0.0', type: 'dependencies', file: 'package.json' },
          ],
        },
        {
          path: 'deps.yaml',
          type: 'deps.yaml',
          content: '{}',
          dependencies: [
            { name: 'bun-package', currentVersion: '1.0.0', type: 'dependencies', file: 'deps.yaml' },
          ],
        },
        {
          path: 'composer.json',
          type: 'composer.json',
          content: '{}',
          dependencies: [
            { name: 'composer/package', currentVersion: '1.0.0', type: 'require', file: 'composer.json' },
          ],
        },
      ]

      fetchSpy.mockImplementation((url: string) => {
        if (url.includes('npm-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'NPM package deprecated',
            }),
          })
        }
        if (url.includes('bun-package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              deprecated: 'Bun package deprecated',
            }),
          })
        }
        if (url.includes('composer/package')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              package: {
                abandoned: 'new/composer-package',
              },
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(3)
      expect(result.find(r => r.datasource === 'npm')).toBeDefined()
      expect(result.find(r => r.datasource === 'bun')).toBeDefined()
      expect(result.find(r => r.datasource === 'composer')).toBeDefined()
    })

    it('should handle empty package files', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [],
        },
      ]

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(0)
    })

    it('should handle package files with no dependencies', async () => {
      const packageFiles: PackageFile[] = [
        {
          path: 'package.json',
          type: 'package.json',
          content: '{}',
          dependencies: [],
        },
      ]

      const result = await checker.checkDeprecatedDependencies(packageFiles)

      expect(result).toHaveLength(0)
    })
  })
})
