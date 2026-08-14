import type { Dependency, PackageFile, PackageUpdate } from '../types'
import process from 'node:process'
import { fetchWithTimeout } from './http'
import { getDefaultLogger } from './logger'

/**
 * Extensions that appear on files *about* Dockerfiles rather than build files,
 * which the prefix match would otherwise pick up (`Dockerfile.md`).
 */
const NON_DOCKERFILE_EXTENSIONS = ['.md', '.txt', '.log', '.bak', '.orig', '.example', '.sample', '.tmpl', '.template']

/**
 * Check whether a file path names a container build file.
 *
 * Recognises the three conventions in real use:
 *
 * - `Dockerfile` and any `Dockerfile.<suffix>` variant (`Dockerfile.prod`)
 * - the reversed `<prefix>.dockerfile` form (`api.dockerfile`), which is what
 *   monorepos use when several build files share a directory
 * - `Containerfile`, the OCI/Podman spelling
 *
 * Matching is case-insensitive because both `Dockerfile` and `dockerfile`
 * occur in the wild and case-sensitive filesystems keep them distinct.
 *
 * @param filePath - Path to test; only the basename is considered
 * @returns Whether the file should be parsed for base images
 * @example
 * ```ts
 * isDockerfile('Dockerfile') // true
 * isDockerfile('docker/api.dockerfile') // true
 * isDockerfile('deploy/Containerfile') // true
 * isDockerfile('dockerfile.md') // false — documentation, not a build file
 * ```
 */
export function isDockerfile(filePath: string): boolean {
  const fileName = (filePath.split('/').pop() || '').toLowerCase()
  if (!fileName)
    return false

  // Documentation about Dockerfiles is not a Dockerfile.
  if (NON_DOCKERFILE_EXTENSIONS.some(extension => fileName.endsWith(extension)))
    return false

  if (fileName === 'containerfile' || fileName.startsWith('containerfile.'))
    return true

  // `Dockerfile` and `Dockerfile.<suffix>`
  if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.'))
    return true

  // `<prefix>.dockerfile` / `<prefix>.containerfile`
  return fileName.endsWith('.dockerfile') || fileName.endsWith('.containerfile')
}

/**
 * Parse a Dockerfile to extract image dependencies with versions
 */
export async function parseDockerfile(filePath: string, content: string): Promise<PackageFile | null> {
  try {
    if (!isDockerfile(filePath)) {
      return null
    }

    const dependencies: Dependency[] = []
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // Skip comments and empty lines
      if (!line || line.startsWith('#')) {
        continue
      }

      // Parse FROM instructions
      const fromMatch = line.match(/^FROM\s+(\S+)(?:\s+as\s+\w+)?$/i)
      if (fromMatch) {
        const imageRef = fromMatch[1]

        // Skip scratch and other special base images
        if (imageRef === 'scratch' || imageRef.startsWith('$')) {
          continue
        }

        const parsedImage = parseImageReference(imageRef)
        if (parsedImage) {
          dependencies.push({
            name: parsedImage.name,
            currentVersion: parsedImage.version,
            type: 'docker-image',
            file: filePath,
          })
        }
      }

    }

    return {
      path: filePath,
      type: 'Dockerfile',
      content,
      dependencies,
    }
  }
  catch (error) {
    getDefaultLogger().warn(`Failed to parse Dockerfile ${filePath}:`, error)
    return null
  }
}

/**
 * Parse a Docker image reference into name and version components
 */
function parseImageReference(imageRef: string): { name: string, version: string } | null {
  try {
    // Handle different image reference formats:
    // - image:tag
    // - registry/image:tag
    // - registry:port/image:tag
    // - registry/namespace/image:tag

    let name: string
    let version: string

    if (imageRef.includes(':')) {
      const lastColonIndex = imageRef.lastIndexOf(':')
      const beforeColon = imageRef.substring(0, lastColonIndex)
      const afterColon = imageRef.substring(lastColonIndex + 1)

      // Check if what's after the colon looks like a port number (registry:port/image case)
      if (/^\d+\//.test(afterColon)) {
        // This is a registry:port/image format, no version specified
        name = imageRef
        version = 'latest'
      }
      else {
        // This is image:version format
        name = beforeColon
        version = afterColon
      }
    }
    else {
      // No version specified, defaults to latest
      name = imageRef
      version = 'latest'
    }

    // Skip if version contains variables or is a digest
    if (version.includes('$') || version.startsWith('sha256:')) {
      return null
    }

    return { name, version }
  }
  catch (error) {
    getDefaultLogger().warn(`Failed to parse image reference ${imageRef}:`, error)
    return null
  }
}

/**
 * Fetch the latest version for a Docker image
 */
export async function fetchLatestDockerImageVersion(imageName: string): Promise<string | null> {
  try {
    // For popular images, we can use Docker Hub API
    // For now, implement a basic version that handles common cases

    const cleanImageName = imageName.replace(/^docker\.io\//, '').replace(/^library\//, '')

    // Handle official images (no slash in name)
    let apiUrl: string
    if (!cleanImageName.includes('/')) {
      // Official image like 'node', 'python', 'ubuntu'
      apiUrl = `https://registry.hub.docker.com/v2/repositories/library/${cleanImageName}/tags/?page_size=100`
    }
    else {
      // User/org image like 'alpine/git'
      apiUrl = `https://registry.hub.docker.com/v2/repositories/${cleanImageName}/tags/?page_size=100`
    }

    // Docker Hub throttles anonymous callers aggressively; a personal access
    // token in DOCKERHUB_TOKEN lifts the limit when one is configured.
    const headers: Record<string, string> = { 'User-Agent': 'buddy-bot' }
    const dockerToken = process.env.DOCKERHUB_TOKEN || process.env.DOCKER_TOKEN
    if (dockerToken)
      headers.Authorization = `Bearer ${dockerToken}`

    const response = await fetchWithTimeout(apiUrl, { headers })
    if (!response.ok) {
      getDefaultLogger().warn(`Failed to fetch tags for ${imageName}: ${response.status}`)
      return null
    }

    const data = await response.json() as { results?: Array<{ name: string }> }
    if (!data.results || !Array.isArray(data.results)) {
      return null
    }

    // Filter and sort tags to find the latest stable version
    const tags = data.results
      .map((tag: any) => tag.name)
      .filter((tag: string) => {
        // Skip tags that are clearly not version numbers
        if (tag === 'latest' || tag.includes('rc') || tag.includes('beta') || tag.includes('alpha')) {
          return false
        }
        // Look for semantic version patterns
        return /^\d+(?:\.\d+)*(?:-\w+)?$/.test(tag)
      })
      .sort((a: string, b: string) => {
        // Simple version comparison - could be improved with proper semver
        const aParts = a.split('.').map(Number)
        const bParts = b.split('.').map(Number)

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aVal = aParts[i] || 0
          const bVal = bParts[i] || 0
          if (aVal !== bVal) {
            return bVal - aVal // Descending order
          }
        }
        return 0
      })

    return tags.length > 0 ? tags[0] : null
  }
  catch (error) {
    getDefaultLogger().warn(`Failed to fetch latest version for Docker image ${imageName}:`, error)
    return null
  }
}

/**
 * Update Dockerfile content with new image versions
 */
export async function updateDockerfile(filePath: string, content: string, updates: PackageUpdate[]): Promise<string> {
  try {
    if (!isDockerfile(filePath)) {
      getDefaultLogger().info(`⚠️ updateDockerfile: ${filePath} is not a Dockerfile, returning original content`)
      return content
    }

    let updatedContent = content

    // Apply updates using string replacement to preserve formatting
    for (const update of updates) {
      if (update.dependencyType !== 'docker-image') {
        continue
      }

      // Clean image name (remove dependency type info)
      const cleanImageName = update.name.replace(/\s*\(.*\)$/, '')

      // Create regex to find FROM instructions with this image
      // Handle various formats: FROM image:tag, FROM image:tag as alias
      const escapedImageName = cleanImageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const fromRegex = new RegExp(
        `(FROM\\s+${escapedImageName})(:)([^\\s]+)(\\s.*)?$`,
        'gim',
      )

      // Check if current version should be respected (like "latest", etc.)
      const shouldRespectVersion = (version: string): boolean => {
        const dynamicIndicators = ['latest', 'main', 'master', 'develop', 'dev', 'stable']
        const cleanVersion = version.toLowerCase().trim()
        return dynamicIndicators.includes(cleanVersion)
      }

      // Find and update the FROM instruction
      const matches = updatedContent.matchAll(fromRegex)
      for (const match of matches) {
        const fullMatch = match[0]
        const beforeColon = match[1] // "FROM image"
        const colon = match[2] // ":"
        const currentVersion = match[3] // "tag"
        const afterVersion = match[4] || '' // " as alias" or empty

        if (shouldRespectVersion(currentVersion)) {
          getDefaultLogger().info(`⚠️ Skipping update for ${cleanImageName} - version "${currentVersion}" should be respected`)
          continue
        }

        // Replace with new version
        const replacement = `${beforeColon}${colon}${update.newVersion}${afterVersion}`
        updatedContent = updatedContent.replace(fullMatch, replacement)

        getDefaultLogger().info(`📝 Updated ${cleanImageName}: ${currentVersion} → ${update.newVersion}`)
      }
    }

    return updatedContent
  }
  catch (error) {
    getDefaultLogger().warn(`Failed to update Dockerfile ${filePath}:`, error)
    return content
  }
}

/**
 * Generate file changes for Dockerfiles
 */
export async function generateDockerfileUpdates(updates: PackageUpdate[]): Promise<Array<{ path: string, content: string, type: 'update' }>> {
  const fileUpdates: Array<{ path: string, content: string, type: 'update' }> = []

  // Group updates by file
  const updatesByFile = new Map<string, PackageUpdate[]>()

  for (const update of updates) {
    if (update.dependencyType === 'docker-image' && isDockerfile(update.file)) {
      if (!updatesByFile.has(update.file)) {
        updatesByFile.set(update.file, [])
      }
      updatesByFile.get(update.file)!.push(update)
    }
  }

  // Process each file
  for (const [filePath, dockerUpdates] of updatesByFile) {
    try {
      // Read current file content
      const fs = await import('node:fs')
      if (fs.existsSync(filePath)) {
        const currentContent = fs.readFileSync(filePath, 'utf-8')
        const updatedContent = await updateDockerfile(filePath, currentContent, dockerUpdates)

        // Only add file update if content actually changed
        if (updatedContent !== currentContent) {
          fileUpdates.push({
            path: filePath,
            content: updatedContent,
            type: 'update',
          })
          getDefaultLogger().info(`✅ Generated update for ${filePath} with ${dockerUpdates.length} image changes`)
        }
        else {
          getDefaultLogger().info(`ℹ️ No changes needed for ${filePath} - versions already up to date`)
        }
      }
      else {
        getDefaultLogger().warn(`⚠️ Dockerfile ${filePath} does not exist`)
      }
    }
    catch (error) {
      getDefaultLogger().warn(`Failed to generate updates for Dockerfile ${filePath}:`, error)
    }
  }

  return fileUpdates
}
