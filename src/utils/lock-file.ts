/* eslint-disable no-console */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { detectPackageManager } from './helpers'

export type PackageManagerType = 'bun' | 'npm' | 'yarn' | 'pnpm' | 'composer'

export interface LockFileResult {
  success: boolean
  packageManager: PackageManagerType
  message: string
}

/**
 * All lock file names that may need to be staged after regeneration
 */
export function getAllLockFilePaths(): string[] {
  return [
    'bun.lock',
    'bun.lockb',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'composer.lock',
  ]
}

/**
 * Get the install command for a given package manager
 */
function getInstallCommand(packageManager: PackageManagerType): { command: string, args: string[] } {
  switch (packageManager) {
    case 'bun':
      return { command: 'bun', args: ['install'] }
    case 'npm':
      return { command: 'npm', args: ['install'] }
    case 'yarn':
      return { command: 'yarn', args: ['install'] }
    case 'pnpm':
      return { command: 'pnpm', args: ['install'] }
    case 'composer':
      return { command: 'composer', args: ['update', '--lock'] }
  }
}

/**
 * Regenerate lock file by running the appropriate install command.
 * Non-fatal: catches errors, logs warnings, returns a result object.
 * @param packageManager - The package manager to use
 * @param cwd - Working directory to run the command in
 * @param timeoutMs - Timeout in milliseconds (default: 5 minutes)
 */
export async function regenerateLockFile(
  packageManager: PackageManagerType,
  cwd: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<LockFileResult> {
  const { command, args } = getInstallCommand(packageManager)

  console.log(`🔄 Regenerating lock file with ${packageManager} (${command} ${args.join(' ')})...`)

  return new Promise<LockFileResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        CI: 'true',
      },
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const timeout = setTimeout(() => {
      killed = true
      console.warn(`⚠️ ${packageManager} install timed out after ${timeoutMs / 1000}s, sending SIGTERM...`)
      child.kill('SIGTERM')

      // Escalate to SIGKILL after 10 seconds
      setTimeout(() => {
        if (!child.killed) {
          console.warn(`⚠️ ${packageManager} install did not exit after SIGTERM, sending SIGKILL...`)
          child.kill('SIGKILL')
        }
      }, 10_000)
    }, timeoutMs)

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeout)

      if (killed) {
        resolve({
          success: false,
          packageManager,
          message: `Lock file regeneration timed out after ${timeoutMs / 1000}s`,
        })
        return
      }

      if (code === 0) {
        console.log(`✅ Lock file regenerated successfully with ${packageManager}`)
        resolve({
          success: true,
          packageManager,
          message: `Lock file regenerated successfully`,
        })
      }
      else {
        console.warn(`⚠️ ${packageManager} install exited with code ${code}`)
        if (stderr)
          console.warn(`   stderr: ${stderr.slice(0, 500)}`)
        resolve({
          success: false,
          packageManager,
          message: `Install exited with code ${code}: ${stderr.slice(0, 200)}`,
        })
      }
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      console.warn(`⚠️ Failed to run ${command}: ${error.message}`)
      resolve({
        success: false,
        packageManager,
        message: `Failed to run ${command}: ${error.message}`,
      })
    })
  })
}

/**
 * Examine which manifest files were updated to determine which package managers
 * need lock file regeneration.
 * @param updatedFilePaths - List of file paths that were updated
 */
export function detectRequiredPackageManagers(updatedFilePaths: string[]): PackageManagerType[] {
  const managers: Set<PackageManagerType> = new Set()

  for (const filePath of updatedFilePaths) {
    const fileName = filePath.split('/').pop() || ''

    if (fileName === 'package.json') {
      // Detect the JS package manager from lock files on disk
      const cwd = process.cwd()
      const jsManager = detectPackageManager(cwd)
      managers.add(jsManager)
    }

    if (fileName === 'composer.json') {
      managers.add('composer')
    }
  }

  return Array.from(managers)
}

/**
 * Check if a lock file exists for a given package manager in the working directory
 */
export function hasLockFile(packageManager: PackageManagerType, cwd: string): boolean {
  const path = require('node:path')

  switch (packageManager) {
    case 'bun':
      return existsSync(path.join(cwd, 'bun.lock')) || existsSync(path.join(cwd, 'bun.lockb'))
    case 'npm':
      return existsSync(path.join(cwd, 'package-lock.json'))
    case 'yarn':
      return existsSync(path.join(cwd, 'yarn.lock'))
    case 'pnpm':
      return existsSync(path.join(cwd, 'pnpm-lock.yaml'))
    case 'composer':
      return existsSync(path.join(cwd, 'composer.lock'))
  }
}
