const GENERATED_DEPENDENCY_DIRECTORIES = new Set([
  'bower_components',
  'node_modules',
  'pantry',
  'ts-pantry',
  'vendor',
])

const GENERATED_OUTPUT_DIRECTORIES = new Set([
  '.cache',
  '.idea',
  '.next',
  '.nuxt',
  '.nyc_output',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'temp',
  'tmp',
])

/**
 * Package discovery must not descend into installed dependencies, generated
 * package-manager trees, or build output. Manifests in those directories are
 * implementation details, not dependency declarations owned by the project.
 */
export function shouldSkipPackageDirectory(dirName: string): boolean {
  return dirName.startsWith('.')
    || GENERATED_DEPENDENCY_DIRECTORIES.has(dirName)
    || GENERATED_OUTPUT_DIRECTORIES.has(dirName)
}
