#!/usr/bin/env qjs --std
import * as os from 'qjs:os'
import * as std from 'qjs:std'

// Helper functions to mimic Node.js fs functions
function existsSync(path) {
  try {
    const [_, err] = os.stat(path)
    return err === 0
  }
  catch (e) {
    return false
  }
}

function readdirSync(path) {
  try {
    const [dirs, err] = os.readdir(path)
    if (err !== 0)
      throw new Error(`Failed to read directory: ${std.strerror(err)}`)
    return dirs
  }
  catch (e) {
    throw e
  }
}

function statSync(path) {
  try {
    const [stats, err] = os.stat(path)
    if (err !== 0)
      throw new Error(`Failed to stat file: ${std.strerror(err)}`)
    return stats
  }
  catch (e) {
    throw e
  }
}

function join(...paths) {
  return paths.join('/').replace(/\/+/g, '/')
}

// Read package.json for version
const packageJsonPath = join(scriptArgs[0], '../package.json')
let version = '0.0.0'

try {
  const packageJsonContent = std.loadFile(packageJsonPath)
  if (packageJsonContent) {
    const packageJson = JSON.parse(packageJsonContent)
    version = packageJson.version
  }
}
catch (e) {
  console.log('Failed to load package.json:', e)
}

// CLI implementation
function printHelp() {
  console.log('Usage: buddy [command] [options]')
  console.log('')
  console.log('Commands:')
  console.log('  new, create       Create a new Stacks project')
  console.log('  cd <project>      Change the current working directory to a different Stacks project')
  console.log('  version           Show the version of the Stacks CLI')
  console.log('  help              Show this help message')
  console.log('')
}

function printVersion() {
  console.log(version)
}

function createNewProject() {
  const buddyCli = 'buddy'

  if (existsSync(buddyCli)) {
    const args = scriptArgs.slice(1).join(' ')
    const result = std.system(`${buddyCli} ${args}`)
    if (result !== 0) {
      console.log(`Command failed with exit code ${result}`)
    }
    return
  }

  let currentDir = os.getcwd()[0]
  let found = false

  while (currentDir !== '/') {
    if (existsSync(`${currentDir}/storage/framework/core/buddy`)) {
      // if the buddy directory exists, we know we are in a stacks project
      found = true
      break
    }
    currentDir = currentDir.split('/').slice(0, -1).join('/')
  }

  if (!found) {
    console.error('No stacks project found. Do you want to create a new stacks project?')
    // TODO: add prompt for user input
    std.exit(1)
  }

  const result = std.system(`./buddy new ${scriptArgs.slice(1).join(' ')}`)
  if (result !== 0) {
    console.log(`Command failed with exit code ${result}`)
  }
}

function changeDirectory(project) {
  const findProjectPath = (base, target) => {
    const queue = [base]

    while (queue.length) {
      const currentPath = queue.shift()
      console.log(`Checking ${currentPath}...`)

      try {
        const directoryContents = readdirSync(currentPath)

        for (const content of directoryContents) {
          const contentPath = join(currentPath, content)

          try {
            const stats = statSync(contentPath)
            const isDirectory = stats.mode & os.S_IFDIR

            if (isDirectory) {
              if (contentPath.includes(target))
                return contentPath // Found the target directory

              queue.push(contentPath)
            }
          }
          catch (e) {
            // Skip if we can't access this path
          }
        }
      }
      catch (e) {
        // Skip if we can't read this directory
      }
    }

    return null // Target directory not found
  }

  const projectPath = findProjectPath('/', `${project}/storage/framework/core/buddy/`)

  if (projectPath) {
    console.log(`Project found at ${projectPath}.`)
    console.log(`Run 'cd ${projectPath}' to navigate to the project directory.`)
  }
  else {
    console.error('Project directory not found.')
  }
}

// Proxy any command to the ./buddy file
function proxyCommand() {
  if (existsSync('./buddy')) {
    const args = scriptArgs.slice(1).join(' ')
    const result = std.system(`./buddy ${args}`)

    if (result !== 0) {
      console.log(`Command failed with exit code ${result}`)
    }

    return true
  }

  return false
}

// Main CLI logic
function main() {
  const args = scriptArgs.slice(1)

  if (args.length === 0) {
    printHelp()
    return
  }

  const command = args[0]

  switch (command) {
    case 'new':
    case 'create':
      createNewProject()
      break

    case 'cd':
      if (args.length < 2) {
        console.error('Error: Missing project name')
        std.exit(1)
      }
      changeDirectory(args[1])
      break

    case 'version':
      printVersion()
      break

    case 'help':
      printHelp()
      break

    default:
      // Try to proxy the command to the ./buddy file
      if (!proxyCommand()) {
        console.error(`Unknown command: ${command}`)
        printHelp()
        std.exit(1)
      }
  }
}

main()
