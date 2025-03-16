import type { WatchConfig } from './types'
import { watch } from 'node:fs'
import { resolve } from 'node:path'
import { runCommand } from '@stacksjs/cli'

export class FolderWatcher {
  private watchers: Map<string, ReturnType<typeof watch>> = new Map()
  private isRunning = false

  private static DEFAULT_IGNORE_DIRS = [
    // Build outputs
    'dist',
    'build',
    'out',
    'cdk.out',
    '.next',
    '.nuxt',
    '.output',

    // Dependencies
    'node_modules',
    'bower_components',
    'vendor',
    '.pnpm-store',

    // Version control
    '.git',

    // Cache directories
    '.cache',
    '.temp',
    '.tmp',
    '.swc',
    '.turbo',
    '.parcel-cache',

    // IDE and editor directories
    '.idea',
    '.vscode',
    '.vs',
    '.fleet',

    // Build tool specific
    '.webpack',
    '.rollup.cache',
    '.vite',

    // Test and coverage
    'coverage',
    '.nyc_output',
    'cypress',

    // Generated docs
    'docs/_site',
    '.docusaurus',

    // Container and deployment
    '.docker',
    '.serverless',
  ]

  constructor(private config: WatchConfig) {
    // Set default mode to interactive
    this.config.mode = this.config.mode ?? 'interactive'

    // Normalize all paths
    this.config.paths = this.config.paths.map(path => resolve(path))

    // Combine custom and default ignore patterns
    this.config.ignoreDirs = [
      ...(this.config.ignoreDirs || []).map(path => resolve(path)),
      ...FolderWatcher.DEFAULT_IGNORE_DIRS.map(path => resolve(path)),
    ]
  }

  private shouldIgnore(path: string): boolean {
    const fullPath = resolve(path)
    return this.config.ignoreDirs?.some(dir => fullPath.includes(dir)) ?? false
  }

  private async handleChange(event: string, filename: string, watchedPath: string) {
    if (this.shouldIgnore(filename)) {
      return
    }

    try {
      const fullPath = resolve(watchedPath, filename)
      console.log(`[${new Date().toISOString()}] Detected ${event} in ${fullPath}`)

      await runCommand('handle-file-change', {
        cwd: fullPath,
      })
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error handling change: ${errorMessage}`)

      if (this.config.onError) {
        this.config.onError(error instanceof Error ? error : new Error(errorMessage))
      }
    }
  }

  private setupInteractiveMode(): void {
    console.log('Running in interactive mode (Press Ctrl+C to exit)')

    process.on('SIGINT', () => {
      console.log('\nReceived Ctrl+C, shutting down...')
      this.stop()
      process.exit(0)
    })
  }

  private setupDaemonMode(): void {
    console.log('Running in daemon mode')

    // Ignore SIGINT in daemon mode
    process.on('SIGINT', () => {
      console.log('Received Ctrl+C but ignoring in daemon mode')
    })

    // Handle termination signal
    process.on('SIGTERM', () => {
      console.log('Received termination signal, shutting down...')
      this.stop()
      process.exit(0)
    })

    // Log PID for daemon management
    const pid = process.pid
    console.log(`Process running with PID: ${pid}`)
  }

  public start(): void {
    if (this.isRunning) {
      console.warn('Watcher is already running')
      return
    }

    this.isRunning = true

    for (const path of this.config.paths) {
      try {
        const watcher = watch(
          path,
          { recursive: true },
          (event, filename) => {
            if (filename) {
              void this.handleChange(event, filename, path)
            }
          },
        )

        this.watchers.set(path, watcher)
        console.log(`Started watching: ${path}`)

        watcher.on('error', (error) => {
          console.error(`Watcher error for ${path}:`, error)
          if (this.config.onError) {
            this.config.onError(error)
          }
        })
      }
      catch (error) {
        console.error(`Failed to start watching ${path}:`, error)
        if (this.config.onError) {
          this.config.onError(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    // Setup mode-specific behavior
    if (this.config.mode === 'daemon') {
      this.setupDaemonMode()
    }
    else {
      this.setupInteractiveMode()
    }
  }

  public stop(): void {
    if (!this.isRunning) {
      return
    }

    for (const [path, watcher] of this.watchers.entries()) {
      try {
        watcher.close()
        console.log(`Stopped watching: ${path}`)
      }
      catch (error) {
        console.error(`Error closing watcher for ${path}:`, error)
      }
    }

    this.watchers.clear()
    this.isRunning = false
  }
}
