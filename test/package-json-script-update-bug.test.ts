import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { Buddy } from '../src/buddy'
import type { PackageUpdate } from '../src/types'

describe('Package.json Script Update Bug', () => {
  let tempDir: string
  let packageJsonPath: string
  let buddy: Buddy

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'buddy-test-'))
    packageJsonPath = path.join(tempDir, 'package.json')

    // Create a package.json with a script that has the same name as a dependency
    const packageJson = {
      name: 'test-package',
      version: '1.0.0',
      scripts: {
        prettier: 'bunx prettier --write .',
        test: 'bun test'
      },
      dependencies: {
        prettier: '^3.0.0',
        typescript: '^5.0.0'
      },
      devDependencies: {
        '@types/node': '^20.0.0'
      }
    }

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))

    // Initialize Buddy instance
    buddy = new Buddy({
      repository: {
        provider: 'github',
        owner: 'test',
        name: 'test-repo',
        token: 'fake-token'
      }
    })
  })

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should not update script values when updating dependency versions', async () => {
    // Simulate updating prettier from 3.0.0 to 3.6.2
    const updates: PackageUpdate[] = [{
      name: 'prettier',
      currentVersion: '3.0.0',
      newVersion: '3.6.2',
      file: packageJsonPath,
      updateType: 'minor',
      dependencyType: 'dependencies'
    }]

    // Generate file updates
    const fileUpdates = await buddy.generateAllFileUpdates(updates)

    // Find the package.json update
    const packageUpdate = fileUpdates.find(update => update.path === packageJsonPath)
    expect(packageUpdate).toBeDefined()

    if (packageUpdate) {
      const updatedContent = JSON.parse(packageUpdate.content)

      // The dependency should be updated
      expect(updatedContent.dependencies.prettier).toBe('^3.6.2')

      // The script should NOT be updated - it should remain the original command
      expect(updatedContent.scripts.prettier).toBe('bunx prettier --write .')

      // Other scripts should remain unchanged
      expect(updatedContent.scripts.test).toBe('bun test')

      // Other dependencies should remain unchanged
      expect(updatedContent.dependencies.typescript).toBe('^5.0.0')
      expect(updatedContent.devDependencies['@types/node']).toBe('^20.0.0')
    }
  })

  it('should handle multiple dependency updates without affecting scripts', async () => {
    const updates: PackageUpdate[] = [
      {
        name: 'prettier',
        currentVersion: '3.0.0',
        newVersion: '3.6.2',
        file: packageJsonPath,
        updateType: 'minor',
        dependencyType: 'dependencies'
      },
      {
        name: 'typescript',
        currentVersion: '5.0.0',
        newVersion: '5.3.0',
        file: packageJsonPath,
        updateType: 'minor',
        dependencyType: 'dependencies'
      }
    ]

    const fileUpdates = await buddy.generateAllFileUpdates(updates)
    const packageUpdate = fileUpdates.find(update => update.path === packageJsonPath)

    if (packageUpdate) {
      const updatedContent = JSON.parse(packageUpdate.content)

      // Dependencies should be updated
      expect(updatedContent.dependencies.prettier).toBe('^3.6.2')
      expect(updatedContent.dependencies.typescript).toBe('^5.3.0')

      // Scripts should remain unchanged
      expect(updatedContent.scripts.prettier).toBe('bunx prettier --write .')
      expect(updatedContent.scripts.test).toBe('bun test')
    }
  })

  it('should preserve exact formatting and spacing in package.json', async () => {
    // Create a package.json with specific formatting
    const formattedPackageJson = `{
  "name": "test-package",
  "version": "1.0.0",
  "scripts": {
    "prettier": "bunx prettier --write .",
    "test": "bun test"
  },
  "dependencies": {
    "prettier": "^3.0.0",
    "typescript": "^5.0.0"
  }
}`

    fs.writeFileSync(packageJsonPath, formattedPackageJson)

    const updates: PackageUpdate[] = [{
      name: 'prettier',
      currentVersion: '3.0.0',
      newVersion: '3.6.2',
      file: packageJsonPath,
      updateType: 'minor',
      dependencyType: 'dependencies'
    }]

    const fileUpdates = await buddy.generateAllFileUpdates(updates)
    const packageUpdate = fileUpdates.find(update => update.path === packageJsonPath)

    if (packageUpdate) {
      // Check that the script line is preserved exactly
      expect(packageUpdate.content).toContain('"prettier": "bunx prettier --write ."')

      // Check that the dependency line is updated
      expect(packageUpdate.content).toContain('"prettier": "^3.6.2"')

      // Ensure we don't have the wrong update
      expect(packageUpdate.content).not.toContain('"prettier": "3.6.2"') // This would be the script being wrongly updated
    }
  })
})
