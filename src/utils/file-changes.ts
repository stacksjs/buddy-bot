import type { FileChange } from '../types'
import { posix } from 'node:path'

export class FileChangeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileChangeValidationError'
  }
}

/**
 * Convert a user or scanner supplied path into a safe repository-relative path.
 */
export function normalizeRepositoryPath(filePath: string): string {
  const normalized = posix.normalize(filePath.replaceAll('\\', '/').replace(/^\.\/+/, ''))

  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) {
    throw new FileChangeValidationError(`Refusing unsafe repository path: ${JSON.stringify(filePath)}`)
  }

  return normalized
}

/**
 * An update must modify a file that already exists on the base branch. Treating
 * a missing update target as a create is how generated cache paths can leak
 * into dependency PRs.
 */
export async function assertUpdateTargetsExist(
  files: FileChange[],
  targetExists: (path: string) => boolean | Promise<boolean>,
): Promise<void> {
  for (const file of files) {
    const cleanPath = normalizeRepositoryPath(file.path)
    if (file.type === 'update' && !(await targetExists(cleanPath))) {
      throw new FileChangeValidationError(
        `Refusing to create missing update target: ${cleanPath}. Use change type "create" for intentional new files.`,
      )
    }
  }
}
