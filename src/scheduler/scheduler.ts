import type { BuddyBotConfig } from '../types'
import { Buddy } from '../buddy'
import { ConfigManager } from '../config/config-manager'
import { Logger } from '../utils/logger'

export interface ScheduleConfig {
  /** Cron expression for scheduling */
  cron: string
  /** Timezone for scheduling (e.g., 'America/New_York') */
  timezone?: string
  /** Whether to run on startup */
  runOnStartup?: boolean
  /** Maximum runtime in milliseconds */
  maxRuntime?: number
}

export interface SchedulerJob {
  id: string
  name: string
  schedule: ScheduleConfig
  lastRun?: Date
  nextRun?: Date
  status: 'idle' | 'running' | 'error'
  config: BuddyBotConfig
}

export class Scheduler {
  private jobs = new Map<string, SchedulerJob>()
  private timers = new Map<string, NodeJS.Timeout>()
  private logger: Logger
  private isRunning = false

  constructor(verbose = false) {
    this.logger = verbose ? Logger.verbose() : Logger.quiet()
  }

  /**
   * Add a scheduled job
   */
  addJob(job: SchedulerJob): void {
    this.jobs.set(job.id, job)
    this.scheduleJob(job)
    this.logger.info(`Scheduled job '${job.name}' with cron: ${job.schedule.cron}`)
  }

  /**
   * Remove a scheduled job
   */
  removeJob(jobId: string): void {
    const timer = this.timers.get(jobId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(jobId)
    }
    this.jobs.delete(jobId)
    this.logger.info(`Removed scheduled job: ${jobId}`)
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Scheduler is already running')
      return
    }

    this.isRunning = true
    this.logger.info('🕒 Buddy Scheduler started')

    // Schedule all jobs
    for (const job of this.jobs.values()) {
      this.scheduleJob(job)

      // Run on startup if configured
      if (job.schedule.runOnStartup) {
        this.logger.info(`Running startup job: ${job.name}`)
        setImmediate(() => this.runJob(job))
      }
    }

    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop())
    process.on('SIGTERM', () => this.stop())
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.isRunning) return

    this.isRunning = false
    this.logger.info('🛑 Stopping Buddy Scheduler...')

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()

    this.logger.success('✅ Buddy Scheduler stopped')
    process.exit(0)
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): SchedulerJob | undefined {
    return this.jobs.get(jobId)
  }

  /**
   * List all jobs
   */
  getAllJobs(): SchedulerJob[] {
    return Array.from(this.jobs.values())
  }

  /**
   * Schedule a single job
   */
  private scheduleJob(job: SchedulerJob): void {
    // Clear existing timer
    const existingTimer = this.timers.get(job.id)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const nextRun = this.getNextRunTime(job.schedule.cron, job.schedule.timezone)
    job.nextRun = nextRun || undefined

    if (nextRun) {
      const delay = nextRun.getTime() - Date.now()

      const timer = setTimeout(() => {
        this.runJob(job)
        // Reschedule for next run
        this.scheduleJob(job)
      }, delay)

      this.timers.set(job.id, timer)

      this.logger.debug(`Job '${job.name}' scheduled for ${nextRun.toISOString()}`)
    }
  }

  /**
   * Execute a job
   */
  private async runJob(job: SchedulerJob): Promise<void> {
    if (job.status === 'running') {
      this.logger.warn(`Job '${job.name}' is already running, skipping`)
      return
    }

    job.status = 'running'
    job.lastRun = new Date()

    this.logger.info(`🚀 Running scheduled job: ${job.name}`)

    const startTime = Date.now()
    const timeout = job.schedule.maxRuntime || 30 * 60 * 1000 // 30 minutes default

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), timeout)
      })

      // Run the job with timeout
      const jobPromise = this.executeJob(job)

      await Promise.race([jobPromise, timeoutPromise])

      const duration = Date.now() - startTime
      job.status = 'idle'

      this.logger.success(`✅ Job '${job.name}' completed in ${duration}ms`)
    } catch (error) {
      job.status = 'error'
      this.logger.error(`❌ Job '${job.name}' failed:`, error)
    }
  }

  /**
   * Execute the actual Buddy update process
   */
  private async executeJob(job: SchedulerJob): Promise<void> {
    const buddy = new Buddy(job.config)

    // Run dependency scan
    const scanResult = await buddy.scanForUpdates()

    if (scanResult.updates.length === 0) {
      this.logger.info('No dependency updates found')
      return
    }

    this.logger.info(`Found ${scanResult.updates.length} dependency updates`)

    // Create pull requests if configured
    if (job.config.repository && job.config.pullRequest) {
      await buddy.createPullRequests(scanResult)
      this.logger.success(`Created pull requests for ${scanResult.groups.length} update groups`)
    } else {
      this.logger.info('Repository not configured, skipping PR creation')
    }
  }

  /**
   * Parse cron expression and get next run time
   */
  private getNextRunTime(cronExpression: string, timezone?: string): Date | null {
    try {
      // This is a simplified cron parser
      // In production, you'd want to use a proper cron library like 'node-cron'
      return this.parseCronExpression(cronExpression, timezone)
    } catch (error) {
      this.logger.error(`Invalid cron expression '${cronExpression}':`, error)
      return null
    }
  }

  /**
   * Simple cron expression parser (supports basic patterns)
   */
  private parseCronExpression(cron: string, timezone?: string): Date {
    const parts = cron.trim().split(/\s+/)

    if (parts.length !== 5) {
      throw new Error('Cron expression must have 5 parts: minute hour day month dayOfWeek')
    }

    const [minuteStr, hourStr, dayStr, monthStr, dayOfWeekStr] = parts
    const now = new Date()

    // Apply timezone offset if specified
    if (timezone) {
      // This is simplified - in production use a proper timezone library
      this.logger.debug(`Using timezone: ${timezone}`)
    }

    // Find next valid time (simplified logic)
    const next = new Date(now)
    next.setSeconds(0, 0)

    // Parse hour and minute
    const targetHour = this.parseCronField(hourStr, 0, 23)
    const targetMinute = this.parseCronField(minuteStr, 0, 59)

    if (targetHour.length > 0 && targetMinute.length > 0) {
      // Set to first valid time today or tomorrow
      next.setHours(targetHour[0], targetMinute[0], 0, 0)

      // If time has passed today, schedule for tomorrow
      if (next <= now) {
        next.setDate(next.getDate() + 1)
      }
    } else {
      // Default to next hour
      next.setTime(now.getTime() + 60 * 60 * 1000)
    }

    return next
  }

  /**
   * Parse individual cron field
   */
  private parseCronField(field: string, min: number, max: number): number[] {
    if (field === '*') {
      return Array.from({ length: max - min + 1 }, (_, i) => min + i)
    }

    if (field.includes(',')) {
      return field.split(',').map(Number).filter(n => n >= min && n <= max)
    }

    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number)
      return Array.from({ length: end - start + 1 }, (_, i) => start + i)
    }

    if (field.includes('/')) {
      const [range, step] = field.split('/')
      const values = range === '*' ? Array.from({ length: max - min + 1 }, (_, i) => min + i) : [Number(range)]
      return values.filter((_, i) => i % Number(step) === 0)
    }

    const num = Number(field)
    return isNaN(num) ? [] : [num]
  }

  /**
   * Create a job from configuration
   */
  static createJobFromConfig(config: BuddyBotConfig, jobId = 'default'): SchedulerJob {
    const schedule: ScheduleConfig = {
      cron: config.schedule?.cron || '0 2 * * 1', // Default: Monday 2 AM
      timezone: config.schedule?.timezone,
      runOnStartup: false,
      maxRuntime: 30 * 60 * 1000 // 30 minutes
    }

    return {
      id: jobId,
      name: `Buddy Dependency Updates (${jobId})`,
      schedule,
      status: 'idle',
      config
    }
  }

  /**
   * Predefined schedule presets
   */
  static readonly PRESETS = {
    DAILY: '0 2 * * *',           // 2 AM daily
    WEEKLY: '0 2 * * 1',          // 2 AM Monday
    WEEKDAYS: '0 2 * * 1-5',      // 2 AM weekdays
    TWICE_WEEKLY: '0 2 * * 1,4',  // 2 AM Monday and Thursday
    MONTHLY: '0 2 1 * *',         // 2 AM first of month
    HOURLY: '0 * * * *',          // Every hour
    CUSTOM: (minute: number, hour: number, dayOfWeek = '*') => `${minute} ${hour} * * ${dayOfWeek}`
  }
}
