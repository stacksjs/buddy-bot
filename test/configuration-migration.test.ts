import type { MigrationResult } from '../src/setup'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigurationMigrator } from '../src/setup'

describe('Configuration Migration & Import System', () => {
  let migrator: ConfigurationMigrator
  let testDir: string
  let originalCwd: string

  beforeEach(() => {
    // Create a temporary directory for each test
    testDir = fs.mkdtempSync(join(tmpdir(), 'buddy-config-test-'))
    originalCwd = process.cwd()
    process.chdir(testDir)

    migrator = new ConfigurationMigrator()
  })

  afterEach(() => {
    // Change back to original directory and clean up
    try {
      process.chdir(originalCwd)
    }
    catch {
      // If we can't change back, try a safe directory
      try {
        process.chdir(tmpdir())
      }
      catch {
        process.chdir('/')
      }
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('Tool Detection', () => {
    it('should detect Renovate configuration files', async () => {
      // Create test renovate.json
      fs.writeFileSync('renovate.json', JSON.stringify({
        schedule: ['before 6am'],
        automerge: true,
      }))

      const tools = await migrator.detectExistingTools()

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('renovate')
      expect(tools[0].configFile).toBe('renovate.json')
      expect(tools[0].active).toBe(true)
    })

    it('should detect Dependabot configuration files', async () => {
      // Create test dependabot.yml
      fs.mkdirSync('.github', { recursive: true })
      fs.writeFileSync('.github/dependabot.yml', `
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
`)

      const tools = await migrator.detectExistingTools()

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('dependabot')
      expect(tools[0].configFile).toBe('.github/dependabot.yml')
      expect(tools[0].active).toBe(true)
    })

    it('should detect renovate config in package.json', async () => {
      // Create test package.json with renovate config
      fs.writeFileSync('test-package.json', JSON.stringify({
        name: 'test-package',
        renovate: {
          schedule: ['every weekend'],
          automerge: false,
        },
      }))

      // Mock the file detection to look for our test file
      const originalExistsSync = fs.existsSync
      const existsSpy = spyOn(fs, 'existsSync')
      existsSpy.mockImplementation((path) => {
        if (path === 'package.json')
          return true
        return originalExistsSync(path)
      })

      const originalReadFileSync = fs.readFileSync
      const readSpy = spyOn(fs, 'readFileSync')
      readSpy.mockImplementation((...args: any[]): any => {
        const [path, encoding] = args
        if (path === 'package.json') {
          return fs.readFileSync('test-package.json', encoding)
        }
        return originalReadFileSync(path, encoding)
      })

      const tools = await migrator.detectExistingTools()

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('renovate')
      expect(tools[0].configFile).toBe('package.json')

      // Clean up spies
      existsSpy.mockRestore()
      readSpy.mockRestore()
    })

    it('should detect multiple configuration tools', async () => {
      // Create both renovate and dependabot configs
      fs.writeFileSync('renovate.json', JSON.stringify({ schedule: ['before 6am'] }))
      fs.mkdirSync('.github', { recursive: true })
      fs.writeFileSync('.github/dependabot.yml', 'version: 2\nupdates: []')

      const tools = await migrator.detectExistingTools()

      expect(tools).toHaveLength(2)
      const renovateTools = tools.filter(t => t.name === 'renovate')
      const dependabotTools = tools.filter(t => t.name === 'dependabot')
      expect(renovateTools).toHaveLength(1)
      expect(dependabotTools).toHaveLength(1)
    })

    it('should return empty array when no tools detected', async () => {
      const tools = await migrator.detectExistingTools()
      expect(tools).toHaveLength(0)
    })
  })

  describe('Renovate Migration', () => {
    it('should migrate basic Renovate configuration', async () => {
      const renovateConfig = {
        schedule: ['before 6am'],
        automerge: true,
        automergeStrategy: 'squash',
        ignoreDeps: ['@types/node'],
        assignees: ['team-lead'],
        reviewers: ['senior-dev'],
      }

      fs.writeFileSync('renovate.json', JSON.stringify(renovateConfig))

      const result = await migrator.migrateFromRenovate('renovate.json')

      expect(result.source).toBe('renovate')
      expect(result.configFound).toBe(true)
      expect(result.confidence).toBe('high')
      expect(result.migratedSettings.schedule).toEqual({ preset: 'high-frequency' })
      expect(result.migratedSettings.ignore).toEqual(['@types/node'])
      expect(result.migratedSettings.autoMerge).toEqual({
        enabled: true,
        strategy: 'squash',
      })
      expect(result.migratedSettings.assignees).toEqual(['team-lead'])
      expect(result.migratedSettings.reviewers).toEqual(['senior-dev'])
    })

    it('should migrate Renovate package rules', async () => {
      const renovateConfig = {
        packageRules: [
          {
            groupName: 'React ecosystem',
            matchPackagePatterns: ['react*', '@types/react*'],
            updateTypes: ['minor', 'patch'],
          },
          {
            enabled: false,
            matchPackageNames: ['typescript', '@types/node'],
          },
        ],
      }

      fs.writeFileSync('renovate.json', JSON.stringify(renovateConfig))

      const result = await migrator.migrateFromRenovate('renovate.json')

      expect(result.migratedSettings.packages).toBeDefined()
      expect(result.migratedSettings.packages.groups).toHaveLength(1)
      expect(result.migratedSettings.packages.groups[0]).toEqual({
        name: 'React ecosystem',
        patterns: ['react*', '@types/react*'],
        strategy: 'minor',
      })
      expect(result.migratedSettings.packages.ignore).toEqual(['typescript', '@types/node'])
    })

    it('should detect incompatible features', async () => {
      const renovateConfig = {
        extends: ['config:base'],
        regexManagers: [
          {
            fileMatch: ['Dockerfile'],
            matchStrings: ['ENV VERSION=(?<currentValue>.*?)\\n'],
          },
        ],
      }

      fs.writeFileSync('renovate.json', JSON.stringify(renovateConfig))

      const result = await migrator.migrateFromRenovate('renovate.json')

      expect(result.incompatibleFeatures).toHaveLength(2)
      expect(result.incompatibleFeatures).toContain('extends: Renovate preset extensions not directly supported')
      expect(result.incompatibleFeatures).toContain('regexManagers: Custom regex managers not supported')
      expect(result.confidence).toBe('low')
    })

    it('should migrate from package.json renovate config', async () => {
      const packageJson = {
        name: 'test-package',
        renovate: {
          schedule: ['every weekend'],
          automerge: false,
          ignoreDeps: ['legacy-package'],
        },
      }

      fs.writeFileSync('test-package.json', JSON.stringify(packageJson))

      // Mock fs to redirect package.json reads to our test file
      const originalReadFileSync = fs.readFileSync
      const readSpy = spyOn(fs, 'readFileSync')
      readSpy.mockImplementation((...args: any[]): any => {
        const [path, encoding] = args
        if (path === 'package.json') {
          return fs.readFileSync('test-package.json', encoding)
        }
        return originalReadFileSync(path, encoding)
      })

      const result = await migrator.migrateFromRenovate('package.json')

      expect(result.configFound).toBe(true)
      expect(result.migratedSettings.schedule).toEqual({ preset: 'minimal' })
      expect(result.migratedSettings.autoMerge).toEqual({
        enabled: false,
        strategy: 'squash',
      })
      expect(result.migratedSettings.ignore).toEqual(['legacy-package'])

      // Clean up spy
      readSpy.mockRestore()
    })

    it('should handle parsing errors gracefully', async () => {
      fs.writeFileSync('renovate.json', 'invalid json{')

      const result = await migrator.migrateFromRenovate('renovate.json')

      expect(result.configFound).toBe(false)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('Failed to parse Renovate config')
    })
  })

  describe('Dependabot Migration', () => {
    it('should migrate basic Dependabot configuration', async () => {
      const dependabotYml = `
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    ignore:
      - dependency-name: "@types/node"
      - dependency-name: "typescript"
`

      fs.mkdirSync('.github', { recursive: true })
      fs.writeFileSync('.github/dependabot.yml', dependabotYml)

      const result = await migrator.migrateFromDependabot('.github/dependabot.yml')

      expect(result.source).toBe('dependabot')
      expect(result.configFound).toBe(true)
      expect(result.migratedSettings.schedule).toEqual({ preset: 'standard' })
      expect(result.migratedSettings.ignore).toContain('@types/node')
      expect(result.migratedSettings.ignore).toContain('typescript')
    })

    it('should convert different schedule intervals', async () => {
      const dailyConfig = `
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
`

      fs.mkdirSync('.github', { recursive: true })
      fs.writeFileSync('.github/dependabot.yml', dailyConfig)

      const result = await migrator.migrateFromDependabot('.github/dependabot.yml')

      expect(result.migratedSettings.schedule).toEqual({ preset: 'high-frequency' })
    })

    it('should handle parsing errors gracefully', async () => {
      fs.mkdirSync('.github', { recursive: true })
      fs.writeFileSync('.github/dependabot.yml', 'invalid: yaml: content: [')

      const result = await migrator.migrateFromDependabot('.github/dependabot.yml')

      expect(result.configFound).toBe(true) // File exists but content may fail
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toBe('Dependabot configuration is limited. Consider customizing Buddy Bot settings.')
    })
  })

  describe('Migration Report Generation', () => {
    it('should generate comprehensive migration report', async () => {
      const results: MigrationResult[] = [
        {
          source: 'renovate',
          configFound: true,
          migratedSettings: { schedule: { preset: 'standard' }, ignore: ['@types/node'] },
          warnings: ['Minor issue detected'],
          incompatibleFeatures: ['extends'],
          confidence: 'high',
        },
        {
          source: 'dependabot',
          configFound: true,
          migratedSettings: { schedule: { preset: 'high-frequency' } },
          warnings: [],
          incompatibleFeatures: [],
          confidence: 'medium',
        },
      ]

      const report = await migrator.generateMigrationReport(results)

      expect(report).toContain('Configuration Migration Report')
      expect(report).toContain('RENOVATE Migration')
      expect(report).toContain('DEPENDABOT Migration')
      expect(report).toContain('🟢 high')
      expect(report).toContain('🟡 medium')
      expect(report).toContain('**Config Found**: ✅ Yes')
      expect(report).toContain('**Migrated Settings**: schedule, ignore')
      expect(report).toContain('**Warnings**: 1')
      expect(report).toContain('**Incompatible Features**: 1')
    })

    it('should handle empty migration results', async () => {
      const report = await migrator.generateMigrationReport([])

      expect(report).toContain('Configuration Migration Report')
      expect(report.length).toBeGreaterThan(30) // Has header content
    })
  })
})
