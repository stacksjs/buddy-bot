import type { BuddyBotConfig, PackageUpdate, UpdateGroup } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { Buddy } from '../src/buddy'
import { PullRequestGenerator } from '../src/pr/pr-generator'
import { Scheduler } from '../src/scheduler/scheduler'

describe('Core Functionality Tests', () => {
  const mockConfig: BuddyBotConfig = {
    verbose: false,
    packages: { strategy: 'all' },
    repository: {
      provider: 'github',
      owner: 'test-owner',
      name: 'test-repo',
      token: 'test-token',
    },
  }

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

  describe('Buddy Core', () => {
    it('should initialize Buddy instance', () => {
      const buddy = new Buddy(mockConfig)
      expect(buddy).toBeDefined()
    })

    it('should initialize with minimal config', () => {
      const minimalConfig: BuddyBotConfig = {
        verbose: false,
        packages: { strategy: 'all' },
      }
      const buddy = new Buddy(minimalConfig)
      expect(buddy).toBeDefined()
    })

    it('should have required methods', () => {
      const buddy = new Buddy(mockConfig)
      expect(typeof buddy.scanForUpdates).toBe('function')
      expect(typeof buddy.createPullRequests).toBe('function')
    })
  })

  describe('Scheduler Core', () => {
    it('should initialize Scheduler', () => {
      const scheduler = new Scheduler(false)
      expect(scheduler).toBeDefined()
      scheduler.stop()
    })

    it('should create job from config', () => {
      const job = Scheduler.createJobFromConfig(mockConfig, 'test-job')
      expect(job).toBeDefined()
      expect(job.id).toBe('test-job')
      expect(job.status).toBe('idle')
    })

    it('should have correct presets', () => {
      expect(Scheduler.PRESETS.DAILY).toBe('0 2 * * *')
      expect(Scheduler.PRESETS.WEEKLY).toBe('0 2 * * 1')
      expect(Scheduler.PRESETS.MONTHLY).toBe('0 2 1 * *')
    })

    it('should manage jobs', () => {
      const scheduler = new Scheduler(false)
      const job = Scheduler.createJobFromConfig(mockConfig, 'test-job')

      scheduler.addJob(job)
      expect(scheduler.getAllJobs()).toHaveLength(1)

      scheduler.removeJob('test-job')
      expect(scheduler.getAllJobs()).toHaveLength(0)

      scheduler.stop()
    })
  })

  describe('PR Generator Core', () => {
    it('should initialize PR generator', () => {
      const generator = new PullRequestGenerator()
      expect(generator).toBeDefined()
    })

    it('should generate title for single package', () => {
      const generator = new PullRequestGenerator()
      const title = generator.generateTitle(mockUpdateGroup)
      expect(title).toBe('chore(deps): update dependency typescript to v5.8.3')
    })

    it('should generate title for multiple packages', () => {
      const generator = new PullRequestGenerator()
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

    it('should generate custom template', () => {
      const generator = new PullRequestGenerator()
      const template = 'Update {package_count} packages on {date}'
      const result = generator.generateCustomTemplate(mockUpdateGroup, template)

      expect(result).toContain('Update 1 packages')
      expect(result).toContain('on 20') // Should contain current year
    })
  })

  describe('Configuration Validation', () => {
    it('should handle different package strategies', () => {
      const strategies: Array<'all' | 'major' | 'minor' | 'patch'> = ['all', 'major', 'minor', 'patch']

      strategies.forEach((strategy) => {
        const config: BuddyBotConfig = {
          verbose: false,
          packages: { strategy },
        }

        expect(() => new Buddy(config)).not.toThrow()
      })
    })

    it('should handle repository providers', () => {
      const providers: Array<'github' | 'gitlab'> = ['github', 'gitlab']

      providers.forEach((provider) => {
        const config: BuddyBotConfig = {
          verbose: false,
          packages: { strategy: 'all' },
          repository: {
            provider,
            owner: 'test',
            name: 'repo',
            token: 'token',
          },
        }

        expect(() => new Buddy(config)).not.toThrow()
      })
    })

    it('should handle schedule configuration', () => {
      const config: BuddyBotConfig = {
        verbose: false,
        packages: { strategy: 'all' },
        schedule: {
          cron: '0 9 * * 1-5',
          timezone: 'UTC',
        },
      }

      const job = Scheduler.createJobFromConfig(config, 'scheduled-job')
      expect(job.schedule.cron).toBe('0 9 * * 1-5')
      expect(job.schedule.timezone).toBe('UTC')
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid cron expressions', () => {
      const config: BuddyBotConfig = {
        ...mockConfig,
        schedule: { cron: 'invalid-cron' },
      }

      const job = Scheduler.createJobFromConfig(config, 'invalid-cron-job')
      const scheduler = new Scheduler(false)

      // Invalid cron expressions are caught during execution, not during job creation
      expect(job).toBeDefined()
      expect(job.schedule.cron).toBe('invalid-cron')
      scheduler.stop()
    })

    it('should handle missing configuration gracefully', () => {
      expect(() => new Buddy({} as any)).not.toThrow()
    })

    it('should handle empty update groups', () => {
      const generator = new PullRequestGenerator()
      const emptyGroup: UpdateGroup = {
        name: 'Empty',
        updateType: 'patch',
        title: '',
        body: '',
        updates: [],
      }

      const title = generator.generateTitle(emptyGroup)
      expect(title).toBe('chore(deps): update 0 dependencies (patch)')
    })
  })

  describe('Integration Points', () => {
    it('should pass config through job creation', () => {
      const config: BuddyBotConfig = {
        verbose: true,
        packages: { strategy: 'patch' },
        repository: {
          provider: 'github',
          owner: 'stacksjs',
          name: 'buddy',
          token: 'token',
        },
      }

      const job = Scheduler.createJobFromConfig(config, 'integration-job')
      expect(job.config.packages?.strategy).toBe('patch')
      expect(job.config.repository?.owner).toBe('stacksjs')
      expect(job.config.verbose).toBe(true)
    })

    it('should create consistent job IDs', () => {
      const job1 = Scheduler.createJobFromConfig(mockConfig, 'job-1')
      const job2 = Scheduler.createJobFromConfig(mockConfig, 'job-2')

      expect(job1.id).toBe('job-1')
      expect(job2.id).toBe('job-2')
      expect(job1.id).not.toBe(job2.id)
    })

    it('should maintain update type hierarchy', () => {
      const generator = new PullRequestGenerator()

      const majorGroup: UpdateGroup = {
        name: 'Major Updates',
        updateType: 'major',
        title: '',
        body: '',
        updates: [{ ...mockPackageUpdate, updateType: 'major' }],
      }

      const title = generator.generateTitle(majorGroup)
      expect(title).toContain('typescript')
      expect(title).toContain('5.8.3')
    })
  })
})
