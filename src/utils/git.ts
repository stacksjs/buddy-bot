/* eslint-disable no-console */
import { spawn } from 'node:child_process'

export type SimpleFileUpdate = { path: string; content: string }

async function runGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { stdio: 'pipe', cwd })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', d => (stdout += d.toString()))
    child.stderr?.on('data', d => (stderr += d.toString()))
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || `git exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

/**
 * Compare generated file updates with the current content on a branch.
 * Returns true if any file differs, false if all are identical.
 *
 * It first tries branchName:path locally, then origin/branchName:path.
 */
export async function hasBranchDifferences(fileUpdates: SimpleFileUpdate[], branchName: string, cwd?: string): Promise<boolean> {
  for (const update of fileUpdates) {
    const cleanPath = update.path.replace(/^\.\//, '').replace(/^\/+/, '')

    // Try local branch
    try {
      const localContent = await runGit(['show', `${branchName}:${cleanPath}`], cwd)
      if (localContent !== update.content) return true
      continue
    }
    catch {}

    // Try remote branch
    try {
      const remoteContent = await runGit(['show', `origin/${branchName}:${cleanPath}`], cwd)
      if (remoteContent !== update.content) return true
      continue
    }
    catch {
      // If neither ref exists, conservatively treat as changed
      return true
    }
  }
  return false
}
