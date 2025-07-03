import { beforeAll, beforeEach, afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { Scheduler, type SchedulerJob } from '../src/scheduler/scheduler'
import type { BuddyBotConfig } from '../src/types'

describe('Scheduler', () => {
  let scheduler: Scheduler
  let mockConfig: BuddyBotConfig

  beforeAll(() => {
    process.env.APP_ENV = 'test'
  })

  beforeEach(() => {
    scheduler = new Scheduler(false) // Quiet logging for tests
    mockConfig = {
      verbose: false,
      packages: { strategy: 'all' },
      repository: {
        provider: 'github',
        owner: 'test-owner',
        name: 'test-repo',
        token: 'test-token'
      },
      schedule: {
        cron: '0 2 * * 1', // Monday 2 AM
        timezone: 'UTC'
      }
    }
  })

      afterEach(() => {
    if (scheduler) {
      scheduler.stop()

      // Clear any remaining jobs
      const jobs = scheduler.getAllJobs()
      jobs.forEach(job => {
        scheduler.removeJob(job.id)
      })
    }
  })

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      expect(scheduler).toBeDefined()
    })

    it('should initialize with verbose logging', () => {
      const verboseScheduler = new Scheduler(true)
      expect(verboseScheduler).toBeDefined()
      verboseScheduler.stop()
    })
  })

  describe('job management', () => {
    it('should add a job', () => {
      const job = Scheduler.createJobFromConfig(mockConfig, 'test-job')
      scheduler.addJob(job)

      const retrievedJob = scheduler.getJobStatus('test-job')
      expect(retrievedJob).toBeDefined()
      expect(retrievedJob?.id).toBe('test-job')
      expect(retrievedJob?.status).toBe('idle')
    })

    it('should remove a job', () => {
      const job = Scheduler.createJobFromConfig(mockConfig, 'test-job')
      scheduler.addJob(job)

      scheduler.removeJob('test-job')
      const retrievedJob = scheduler.getJobStatus('test-job')
      expect(retrievedJob).toBeUndefined()
    })

    it('should list all jobs', () => {
      const job1 = Scheduler.createJobFromConfig(mockConfig, 'job1')
      const job2 = Scheduler.createJobFromConfig(mockConfig, 'job2')

      scheduler.addJob(job1)
      scheduler.addJob(job2)

      const allJobs = scheduler.getAllJobs()
      expect(allJobs).toHaveLength(2)
      expect(allJobs.map(j => j.id)).toContain('job1')
      expect(allJobs.map(j => j.id)).toContain('job2')
    })
  })

  describe('createJobFromConfig', () => {
    it('should create job with default schedule', () => {
      const configWithoutSchedule = { ...mockConfig }
      delete configWithoutSchedule.schedule

      const job = Scheduler.createJobFromConfig(configWithoutSchedule)

      expect(job.id).toBe('default')
      expect(job.name).toBe('Buddy Dependency Updates (default)')
      expect(job.schedule.cron).toBe('0 2 * * 1') // Default Monday 2 AM
      expect(job.status).toBe('idle')
      expect(job.config).toEqual(configWithoutSchedule)
    })

    it('should create job with custom schedule', () => {
      const job = Scheduler.createJobFromConfig(mockConfig, 'custom-job')

      expect(job.id).toBe('custom-job')
      expect(job.schedule.cron).toBe('0 2 * * 1')
      expect(job.schedule.timezone).toBe('UTC')
    })

    it('should set maximum runtime', () => {
      const job = Scheduler.createJobFromConfig(mockConfig)

      expect(job.schedule.maxRuntime).toBe(30 * 60 * 1000) // 30 minutes
    })
  })

  describe('cron presets', () => {
    it('should have correct preset values', () => {
      expect(Scheduler.PRESETS.DAILY).toBe('0 2 * * *')
      expect(Scheduler.PRESETS.WEEKLY).toBe('0 2 * * 1')
      expect(Scheduler.PRESETS.WEEKDAYS).toBe('0 2 * * 1-5')
      expect(Scheduler.PRESETS.TWICE_WEEKLY).toBe('0 2 * * 1,4')
      expect(Scheduler.PRESETS.MONTHLY).toBe('0 2 1 * *')
      expect(Scheduler.PRESETS.HOURLY).toBe('0 * * * *')
    })

    it('should generate custom cron expressions', () => {
      const custom = Scheduler.PRESETS.CUSTOM(30, 14, '1-5')
      expect(custom).toBe('30 14 * * 1-5')
    })
  })

    describe('cron parsing', () => {
    it('should parse simple cron expressions', () => {
      const job = Scheduler.createJobFromConfig({
        ...mockConfig,
        schedule: { cron: '0 9 * * *' } // 9 AM daily
      })

      scheduler.addJob(job)
      expect(job.nextRun).toBeDefined()
    })

    it('should handle invalid cron expressions gracefully', () => {
      const job = Scheduler.createJobFromConfig({
        ...mockConfig,
        schedule: { cron: 'invalid cron' }
      })

      // Invalid cron expressions are caught during execution, not during job creation
      expect(job).toBeDefined()
      expect(job.schedule.cron).toBe('invalid cron')
    })

    it('should parse cron with minutes and hours', () => {
      const job = Scheduler.createJobFromConfig({
        ...mockConfig,
        schedule: { cron: '30 14 * * *' } // 2:30 PM daily
      })

      scheduler.addJob(job)
      expect(job.nextRun).toBeDefined()
    })
  })

  describe('scheduler lifecycle', () => {
    it('should have start method', () => {
      expect(typeof scheduler.start).toBe('function')
    })

    it('should have stop method', () => {
      expect(typeof scheduler.stop).toBe('function')
    })
  })

  describe('job execution', () => {
    it('should have executeJob method', () => {
      expect(typeof (scheduler as any).executeJob).toBe('function')
    })

    it('should have runJob method', () => {
      expect(typeof (scheduler as any).runJob).toBe('function')
    })
  })

  describe('time calculations', () => {
    it('should calculate next run time correctly', () => {
      const job = Scheduler.createJobFromConfig({
        ...mockConfig,
        schedule: { cron: '0 9 * * *' } // 9 AM daily
      })

      scheduler.addJob(job)

      if (job.nextRun) {
        const now = new Date()
        expect(job.nextRun.getTime()).toBeGreaterThan(now.getTime())
        expect(job.nextRun.getHours()).toBe(9)
        expect(job.nextRun.getMinutes()).toBe(0)
      }
    })

    it('should handle timezone specifications', () => {
      const job = Scheduler.createJobFromConfig({
        ...mockConfig,
        schedule: {
          cron: '0 9 * * *',
          timezone: 'America/New_York'
        }
      })

      scheduler.addJob(job)
      expect(job.nextRun).toBeDefined()
    })
  })

  describe('integration with Buddy', () => {
    it('should create job for Buddy integration', () => {
      const job = Scheduler.createJobFromConfig(mockConfig, 'integration-test')
      expect(job).toBeDefined()
      expect(job.id).toBe('integration-test')
      expect(job.config).toEqual(mockConfig)
    })
  })

  describe('error scenarios', () => {
    it('should handle missing repository configuration', () => {
      const configWithoutRepo = { ...mockConfig }
      delete configWithoutRepo.repository

      const job = Scheduler.createJobFromConfig(configWithoutRepo, 'no-repo-job')

      // Should still create the job, but execution might log warnings
      expect(job).toBeDefined()
      expect(job.config.repository).toBeUndefined()
    })

    it('should handle malformed cron expressions', () => {
      const job = Scheduler.createJobFromConfig({
        ...mockConfig,
        schedule: { cron: 'not-a-cron' }
      })

      // Should handle gracefully without throwing
      expect(job).toBeDefined()
      expect(job.schedule.cron).toBe('not-a-cron')
    })
  })

  describe('memory management', () => {
    it('should clean up timers when removing jobs', () => {
      const job = Scheduler.createJobFromConfig(mockConfig, 'cleanup-test')
      scheduler.addJob(job)

      // Verify job was added
      expect(scheduler.getJobStatus('cleanup-test')).toBeDefined()

      scheduler.removeJob('cleanup-test')

      // Verify job was removed
      expect(scheduler.getJobStatus('cleanup-test')).toBeUndefined()
    })

    it('should have getAllJobs method', () => {
      expect(typeof scheduler.getAllJobs).toBe('function')
      expect(Array.isArray(scheduler.getAllJobs())).toBe(true)
    })
  })
})
