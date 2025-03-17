import { execSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as os from 'node:os'
import * as path from 'node:path'

// Define the GitHub repository for QuickJS-NG releases
const QUICKJS_REPO = 'https://github.com/quickjs-ng/quickjs'
const QUICKJS_RELEASES_URL = 'https://github.com/quickjs-ng/quickjs/releases'
const GITHUB_API_URL = 'https://api.github.com/repos/quickjs-ng/quickjs/releases/latest'
const FALLBACK_VERSION = 'v0.9.0' // Fallback version if API call fails

// Define the binary names
const QJS_BINARY = os.platform() === 'win32' ? 'qjs.exe' : 'qjs'
const QJSC_BINARY = os.platform() === 'win32' ? 'qjsc.exe' : 'qjsc'

// Define the installation directory - store in the current directory by default
// This ensures both binaries are in the same directory
const INSTALL_DIR: string = path.join(process.cwd(), 'bin')

/**
 * Downloads a file from a URL to a local path, handling redirects
 */
async function downloadFile(url: string, destPath: string, redirectCount = 0): Promise<void> {
  if (redirectCount > 5) {
    throw new Error(`Too many redirects when downloading ${url}`)
  }

  console.log(`Downloading ${url} to ${destPath}...`)

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        const location = response.headers.location
        if (!location) {
          reject(new Error(`Redirect from ${url} did not provide a location header`))
          return
        }

        console.log(`Following redirect to ${location}`)
        // Resolve relative URLs
        const redirectUrl = new URL(location, url).toString()
        downloadFile(redirectUrl, destPath, redirectCount + 1)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`))
        return
      }

      const fileStream = createWriteStream(destPath)
      response.pipe(fileStream)

      fileStream.on('finish', () => {
        fileStream.close()
        console.log(`Downloaded ${url} successfully`)
        resolve()
      })

      fileStream.on('error', (err) => {
        fs.unlinkSync(destPath)
        reject(err)
      })
    })

    request.on('error', (err) => {
      reject(new Error(`Request error for ${url}: ${err.message}`))
    })

    // Set a timeout
    request.setTimeout(30000, () => {
      request.destroy()
      reject(new Error(`Request timeout for ${url}`))
    })
  })
}

/**
 * Makes a file executable (chmod +x)
 */
function makeExecutable(filePath: string): void {
  if (os.platform() !== 'win32') {
    fs.chmodSync(filePath, '755')
  }
}

/**
 * Fetches JSON data from a URL
 */
async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'buddy-quickjs-installer',
        'Accept': 'application/vnd.github.v3+json',
      },
    }

    https.get(url, options, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        const location = response.headers.location
        if (!location) {
          reject(new Error(`Redirect from ${url} did not provide a location header`))
          return
        }

        console.log(`Following redirect to ${location}`)
        // Resolve relative URLs
        const redirectUrl = new URL(location, url).toString()
        fetchJson(redirectUrl)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${url}: ${response.statusCode}`))
        return
      }

      let data = ''
      response.on('data', (chunk) => {
        data += chunk
      })

      response.on('end', () => {
        try {
          const jsonData = JSON.parse(data)
          resolve(jsonData)
        }
        catch (error) {
          reject(new Error(`Failed to parse JSON from ${url}: ${error}`))
        }
      })
    }).on('error', reject)
  })
}

/**
 * Gets the latest QuickJS-NG version from GitHub API
 */
async function getLatestVersion(): Promise<string> {
  try {
    console.log('Fetching latest QuickJS-NG version from GitHub...')
    const releaseData = await fetchJson(GITHUB_API_URL)

    if (releaseData && releaseData.tag_name) {
      console.log(`Found latest version: ${releaseData.tag_name}`)
      return releaseData.tag_name
    }
    else {
      console.warn('Could not determine latest version from GitHub API, using fallback version')
      return FALLBACK_VERSION
    }
  }
  catch (error) {
    console.warn(`Error fetching latest version: ${error}, using fallback version`)
    return FALLBACK_VERSION
  }
}

/**
 * Determines the correct binary URL based on the platform
 */
function getBinaryUrl(version: string, binary: string): string {
  const platform = os.platform()
  const arch = os.arch()

  // Based on the GitHub release page, the binaries are named directly without additional suffixes
  // Example: qjs-darwin, qjsc-darwin, qjs-linux-aarch64, etc.

  if (platform === 'darwin') {
    // macOS binaries are simply named qjs-darwin and qjsc-darwin
    return `${QUICKJS_RELEASES_URL}/download/${version}/${binary}-darwin`
  }
  else if (platform === 'linux') {
    // Linux binaries have architecture-specific names
    if (arch === 'arm64' || arch === 'aarch64') {
      return `${QUICKJS_RELEASES_URL}/download/${version}/${binary}-linux-aarch64`
    }
    else if (arch === 'riscv64') {
      return `${QUICKJS_RELEASES_URL}/download/${version}/${binary}-linux-riscv64`
    }
    else if (arch === 'x86') {
      return `${QUICKJS_RELEASES_URL}/download/${version}/${binary}-linux-x86`
    }
    else {
      // Default to x86_64 for other architectures
      return `${QUICKJS_RELEASES_URL}/download/${version}/${binary}-linux-x86_64`
    }
  }
  else if (platform === 'win32') {
    // Windows binaries have .exe extension in the filename
    if (binary === 'qjs') {
      return `${QUICKJS_RELEASES_URL}/download/${version}/qjs-windows-x86.exe`
    }
    else {
      return `${QUICKJS_RELEASES_URL}/download/${version}/qjsc-windows-x86.exe`
    }
  }
  else {
    throw new Error(`Unsupported platform: ${platform} ${arch}`)
  }
}

/**
 * Checks if a URL is accessible
 */
async function checkUrlExists(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https:') ? https : http

    const request = protocol.get(url, { method: 'HEAD' }, (response) => {
      // Consider redirects as successful
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        resolve(true)
        return
      }

      resolve(response.statusCode === 200)
    })

    request.on('error', () => {
      resolve(false)
    })

    request.setTimeout(5000, () => {
      request.destroy()
      resolve(false)
    })
  })
}

/**
 * Downloads and installs pre-built binaries
 */
async function installPrebuiltBinaries(version: string): Promise<void> {
  try {
    console.log('Downloading QuickJS-NG pre-built binaries...')

    // Create installation directory if it doesn't exist
    if (!fs.existsSync(INSTALL_DIR)) {
      fs.mkdirSync(INSTALL_DIR, { recursive: true })
    }

    // Try to download qjs binary with different URL patterns
    const qjsPath = path.join(INSTALL_DIR, QJS_BINARY)
    let qjsDownloaded = false

    // List of possible URL patterns to try for qjs
    const qjsUrlPatterns = [
      // Standard pattern from our function
      getBinaryUrl(version, 'qjs'),
      // Direct URL for macOS as seen in the image
      `${QUICKJS_RELEASES_URL}/download/${version}/qjs-darwin`,
      // Try without architecture suffix
      `${QUICKJS_RELEASES_URL}/download/${version}/qjs`,
      // Try with platform only
      `${QUICKJS_RELEASES_URL}/download/${version}/qjs-${os.platform()}`,
    ]

    for (const url of qjsUrlPatterns) {
      console.log(`Trying qjs URL: ${url}`)
      const exists = await checkUrlExists(url)

      if (exists) {
        console.log(`Found accessible qjs URL: ${url}`)
        await downloadFile(url, qjsPath)
        qjsDownloaded = true
        break
      }
      else {
        console.log(`URL not accessible: ${url}`)
      }
    }

    if (!qjsDownloaded) {
      throw new Error('Could not find an accessible qjs binary URL')
    }

    // Try to download qjsc binary with different URL patterns
    const qjscPath = path.join(INSTALL_DIR, QJSC_BINARY)
    let qjscDownloaded = false

    // List of possible URL patterns to try for qjsc
    const qjscUrlPatterns = [
      // Standard pattern from our function
      getBinaryUrl(version, 'qjsc'),
      // Direct URL for macOS as seen in the image
      `${QUICKJS_RELEASES_URL}/download/${version}/qjsc-darwin`,
      // Try without architecture suffix
      `${QUICKJS_RELEASES_URL}/download/${version}/qjsc`,
      // Try with platform only
      `${QUICKJS_RELEASES_URL}/download/${version}/qjsc-${os.platform()}`,
    ]

    for (const url of qjscUrlPatterns) {
      console.log(`Trying qjsc URL: ${url}`)
      const exists = await checkUrlExists(url)

      if (exists) {
        console.log(`Found accessible qjsc URL: ${url}`)
        await downloadFile(url, qjscPath)
        qjscDownloaded = true
        break
      }
      else {
        console.log(`URL not accessible: ${url}`)
      }
    }

    if (!qjscDownloaded) {
      throw new Error('Could not find an accessible qjsc binary URL')
    }

    // Make them executable
    makeExecutable(qjsPath)
    makeExecutable(qjscPath)

    console.log('QuickJS-NG binaries installed successfully')
  }
  catch (error) {
    console.error('Failed to install pre-built binaries:', error)
    throw error
  }
}

/**
 * Installs QuickJS-NG binaries
 */
export async function install(): Promise<void> {
  try {
    // Create installation directory if it doesn't exist
    if (!fs.existsSync(INSTALL_DIR)) {
      fs.mkdirSync(INSTALL_DIR, { recursive: true })
    }

    const version = await getLatestVersion()
    console.log(`Installing QuickJS-NG version ${version}...`)

    // Download and install pre-built binaries
    await installPrebuiltBinaries(version)

    // Verify installation
    try {
      const qjsPath = path.join(INSTALL_DIR, QJS_BINARY)

      // The --version flag outputs an error message but still shows the version
      // We need to capture both stdout and stderr
      try {
        // Try to run qjs with no arguments to see if it works at all
        const output = execSync(`"${qjsPath}"`, { stdio: 'pipe', encoding: 'utf8' }).toString()
        console.log('QuickJS-NG installed successfully')
      }
      catch (error: any) {
        // Even if it exits with an error code, check if the output contains version info
        if (error.stderr) {
          const stderrStr = error.stderr.toString()
          if (stderrStr.includes('QuickJS-ng version')) {
            const versionMatch = stderrStr.match(/QuickJS-ng version ([0-9.]+)/)
            if (versionMatch && versionMatch[1]) {
              console.log(`QuickJS-NG installed successfully: version ${versionMatch[1]}`)
            }
            else {
              console.log('QuickJS-NG installed successfully, but could not determine version')
            }
          }
        }
        else if (error.stdout) {
          const stdoutStr = error.stdout.toString()
          if (stdoutStr.includes('QuickJS-ng version')) {
            const versionMatch = stdoutStr.match(/QuickJS-ng version ([0-9.]+)/)
            if (versionMatch && versionMatch[1]) {
              console.log(`QuickJS-NG installed successfully: version ${versionMatch[1]}`)
            }
            else {
              console.log('QuickJS-NG installed successfully, but could not determine version')
            }
          }
        }
        else {
          // Try to extract version from the error message itself
          if (error.message && typeof error.message === 'string' && error.message.includes('QuickJS-ng version')) {
            const msgMatch = error.message.match(/QuickJS-ng version ([0-9.]+)/)
            if (msgMatch && msgMatch[1]) {
              console.log(`QuickJS-NG installed successfully: version ${msgMatch[1]}`)
              return
            }
          }

          throw new Error(`QuickJS-NG verification failed: ${error.message}`)
        }
      }
    }
    catch (error) {
      console.error('Failed to verify QuickJS-NG installation:', error)
      throw new Error('QuickJS-NG installation verification failed')
    }
  }
  catch (error) {
    console.error('Failed to install QuickJS-NG:', error)
    throw error
  }
}

/**
 * Sets the installation directory
 */
export function setInstallDir(dir: string): void {
  // This function allows changing the installation directory
  // It's useful for testing or when you want to install to a custom location
  Object.defineProperty(module.exports, 'INSTALL_DIR', { value: dir })
}

// Function to check if QuickJS-NG is installed
export function isInstalled(): boolean {
  const qjsPath = path.join(INSTALL_DIR, QJS_BINARY)
  return fs.existsSync(qjsPath)
}

// Function to get the path to the QuickJS-NG binary
export function getQjsPath(): string {
  return path.join(INSTALL_DIR, QJS_BINARY)
}

// Function to get the path to the QuickJS-NG compiler binary
export function getQjscPath(): string {
  return path.join(INSTALL_DIR, QJSC_BINARY)
}

// Export the installation directory for reference
export { INSTALL_DIR }
