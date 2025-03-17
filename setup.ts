/* eslint-disable no-console */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import { getQjscPath, getQjsPath, install, INSTALL_DIR, isInstalled } from './src/install'

/**
 * Get the version of QuickJS-NG from the binary
 */
function getQjsVersion(qjsPath: string): string {
  try {
    // Try running with --version flag
    try {
      const output = execSync(`"${qjsPath}" --version`, { stdio: 'pipe' }).toString()
      const versionMatch = output.match(/QuickJS-ng version ([0-9.]+)/)
      if (versionMatch && versionMatch[1]) {
        return versionMatch[1]
      }
    }
    catch (error: any) {
      // The command might exit with an error code but still output the version
      if (error.stderr) {
        const stderrStr = error.stderr.toString()
        if (stderrStr.includes('QuickJS-ng version')) {
          const versionMatch = stderrStr.match(/QuickJS-ng version ([0-9.]+)/)
          if (versionMatch && versionMatch[1]) {
            return versionMatch[1]
          }
        }
      }

      if (error.stdout) {
        const stdoutStr = error.stdout.toString()
        if (stdoutStr.includes('QuickJS-ng version')) {
          const versionMatch = stdoutStr.match(/QuickJS-ng version ([0-9.]+)/)
          if (versionMatch && versionMatch[1]) {
            return versionMatch[1]
          }
        }
      }

      // Try to extract version from the error message itself
      if (error.message && typeof error.message === 'string') {
        const msgMatch = error.message.match(/QuickJS-ng version ([0-9.]+)/)
        if (msgMatch && msgMatch[1]) {
          return msgMatch[1]
        }
      }
    }

    // If we couldn't get the version, just return "unknown"
    return 'unknown'
  }
  catch (error) {
    console.error('Error getting QuickJS-NG version:', error)
    return 'unknown'
  }
}

async function main() {
  try {
    console.log('Testing QuickJS-NG installation...')
    console.log(`Installation directory: ${INSTALL_DIR}`)

    // Check if QuickJS is already installed
    if (isInstalled()) {
      console.log('QuickJS-NG is already installed.')
      console.log(`qjs path: ${getQjsPath()}`)
      console.log(`qjsc path: ${getQjscPath()}`)

      // Verify the binaries work
      try {
        const qjsVersion = getQjsVersion(getQjsPath())
        console.log(`QuickJS-NG version: ${qjsVersion}`)
      }
      catch (error) {
        console.error('Error running qjs:', error)
      }
    }
    else {
      console.log('QuickJS-NG is not installed. Installing now...')
      await install()

      // Verify installation
      if (isInstalled()) {
        console.log('Installation successful!')
        console.log(`qjs path: ${getQjsPath()}`)
        console.log(`qjsc path: ${getQjscPath()}`)

        // Get the version
        const qjsVersion = getQjsVersion(getQjsPath())
        console.log(`QuickJS-NG version: ${qjsVersion}`)

        // Verify the binaries are in the same directory
        const qjsDir = path.dirname(getQjsPath())
        const qjscDir = path.dirname(getQjscPath())

        if (qjsDir === qjscDir) {
          console.log(`Both binaries are in the same directory: ${qjsDir}`)
        }
        else {
          console.error(`Binaries are in different directories: qjs in ${qjsDir}, qjsc in ${qjscDir}`)
        }

        // Run a simple test with qjs
        const testScript = path.join(process.cwd(), 'test-script.js')
        fs.writeFileSync(testScript, 'console.log("Hello from QuickJS!");')

        try {
          // Use stdio: 'pipe' to capture output even if the command exits with an error code
          const output = execSync(`"${getQjsPath()}" ${testScript}`, { stdio: 'pipe' }).toString().trim()
          console.log(`Test script output: ${output}`)
          fs.unlinkSync(testScript) // Clean up
        }
        catch (error: any) {
          // Check if we got output even though the command failed
          if (error.stdout) {
            const stdoutStr = error.stdout.toString().trim()
            console.log(`Test script output (from error): ${stdoutStr}`)
          }
          else if (error.stderr) {
            const stderrStr = error.stderr.toString().trim()
            if (stderrStr.includes('Hello from QuickJS')) {
              console.log(`Test script output (from stderr): ${stderrStr}`)
            }
            else {
              console.error('Error running test script:', stderrStr)
            }
          }
          else {
            console.error('Error running test script:', error)
          }

          // Clean up even if there was an error
          if (fs.existsSync(testScript)) {
            fs.unlinkSync(testScript)
          }
        }

        // Test the qjsc compiler
        try {
          const compileScript = path.join(process.cwd(), 'compile-test.js')
          fs.writeFileSync(compileScript, 'console.log("Compiled with QuickJS!");')

          const compiledOutput = path.join(process.cwd(), 'compiled-test')
          execSync(`"${getQjscPath()}" -o ${compiledOutput} ${compileScript}`)

          if (fs.existsSync(compiledOutput)) {
            console.log('Successfully compiled a test script with qjsc')

            // Make the compiled file executable
            fs.chmodSync(compiledOutput, '755')

            // Run the compiled file
            try {
              const runOutput = execSync(compiledOutput, { stdio: 'pipe' }).toString().trim()
              console.log(`Compiled script output: ${runOutput}`)
            }
            catch (error: any) {
              if (error.stdout) {
                const stdoutStr = error.stdout.toString().trim()
                console.log(`Compiled script output (from error): ${stdoutStr}`)
              }
              else if (error.stderr) {
                const stderrStr = error.stderr.toString().trim()
                if (stderrStr.includes('Compiled with QuickJS')) {
                  console.log(`Compiled script output (from stderr): ${stderrStr}`)
                }
                else {
                  console.error('Error running compiled script:', stderrStr)
                }
              }
              else {
                console.error('Error running compiled script:', error)
              }
            }

            // Clean up
            fs.unlinkSync(compileScript)
            fs.unlinkSync(compiledOutput)
          }
          else {
            console.error('Failed to compile test script')

            // Clean up
            fs.unlinkSync(compileScript)
          }
        }
        catch (error) {
          console.error('Error testing qjsc compiler:', error)

          // Clean up
          const compileScript = path.join(process.cwd(), 'compile-test.js')
          if (fs.existsSync(compileScript)) {
            fs.unlinkSync(compileScript)
          }

          const compiledOutput = path.join(process.cwd(), 'compiled-test')
          if (fs.existsSync(compiledOutput)) {
            fs.unlinkSync(compiledOutput)
          }
        }
      }
      else {
        console.error('Installation failed!')
      }
    }
  }
  catch (error) {
    console.error('Error during testing:', error)
    process.exit(1)
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
