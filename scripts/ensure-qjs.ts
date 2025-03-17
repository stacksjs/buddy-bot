/**
 * This script ensures that the QuickJS-NG binaries are downloaded
 * before attempting to compile the buddy CLI.
 */

import { getQjscPath, getQjsPath, install, isInstalled } from '../src/install'

async function main() {
  try {
    console.log('Ensuring QuickJS-NG binaries are available...')

    if (isInstalled()) {
      console.log('QuickJS-NG binaries are already installed.')
      console.log(`qjs path: ${getQjsPath()}`)
      console.log(`qjsc path: ${getQjscPath()}`)
    }
    else {
      console.log('QuickJS-NG binaries are not installed. Installing now...')
      await install()

      if (isInstalled()) {
        console.log('QuickJS-NG binaries installed successfully.')
        console.log(`qjs path: ${getQjsPath()}`)
        console.log(`qjsc path: ${getQjscPath()}`)
      }
      else {
        console.error('Failed to install QuickJS-NG binaries.')
        process.exit(1)
      }
    }
  }
  catch (error) {
    console.error('Error ensuring QuickJS-NG binaries:', error)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
}).then(() => {
  console.log('QuickJS-NG binaries installed successfully.')
  console.log(`qjs path: ${getQjsPath()}`)
  console.log(`qjsc path: ${getQjscPath()}`)
  process.exit(0)
})
