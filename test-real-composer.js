// Test with the actual composer.json file to reproduce the issue
const fs = require('fs')

async function generateComposerUpdates(updates) {
  const fileUpdates = []
  const composerUpdates = updates.filter(update => update.file.endsWith('composer.json'))

  if (composerUpdates.length === 0) {
    return fileUpdates
  }

  // Group updates by file
  const updatesByFile = new Map()

  for (const update of composerUpdates) {
    if (!updatesByFile.has(update.file)) {
      updatesByFile.set(update.file, [])
    }
    updatesByFile.get(update.file).push({
      name: update.name,
      newVersion: update.newVersion,
    })
  }

  // Process each composer.json file
  for (const [filePath, fileUpdates_] of updatesByFile) {
    try {
      // Read current composer.json content
      let composerContent = fs.readFileSync(filePath, 'utf-8')

      console.log(`🔍 [DEBUG] Reading ${filePath} for updates:`, fileUpdates_.map(u => u.name).join(', '))

      // Parse to understand structure
      const composerData = JSON.parse(composerContent)

      console.log(`📋 [DEBUG] Current versions in ${filePath}:`)
      if (composerData.require) {
        for (const [pkg, version] of Object.entries(composerData.require)) {
          if (fileUpdates_.some(u => u.name === pkg)) {
            console.log(`  ${pkg}: ${version}`)
          }
        }
      }

      // Apply updates using string replacement to preserve formatting
      for (const update of fileUpdates_) {
        let packageFound = false

        // Check in require section
        if (composerData.require && composerData.require[update.name]) {
          const currentVersionInFile = composerData.require[update.name]

          // Simple constraint - extract prefix and apply to new version
          const versionPrefixMatch = currentVersionInFile.match(/^(\D*)/)
          const originalPrefix = versionPrefixMatch ? versionPrefixMatch[1] : ''
          const newVersion = `${originalPrefix}${update.newVersion}`

          // Create regex to find the exact line with this package and version
          const packageRegex = new RegExp(
            `("${update.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*")([^"]+)(")`,
            'g',
          )

          composerContent = composerContent.replace(packageRegex, `$1${newVersion}$3`)
          packageFound = true
          console.log(`✅ Updated ${update.name}: ${currentVersionInFile} -> ${newVersion}`)
        }

        if (!packageFound) {
          console.warn(`Package ${update.name} not found in ${filePath}`)
        }
      }

      fileUpdates.push({
        path: filePath,
        content: composerContent,
        type: 'update',
      })
    }
    catch (error) {
      console.error(`Failed to update ${filePath}:`, error)
    }
  }

  return fileUpdates
}

// Test with individual symfony/console update (should only change symfony/console)
const symfonyUpdate = [
  { name: 'symfony/console', newVersion: 'v7.3.1', file: 'composer.json' }
]

console.log('=== TESTING WITH REAL COMPOSER.JSON ===\n')
console.log('🎯 Expected: Only symfony/console should be updated from ^6.0 to ^v7.3.1\n')

async function runTest() {
  try {
    const result = await generateComposerUpdates(symfonyUpdate)

    if (result.length === 0) {
      console.log('❌ No updates generated!')
    } else {
      console.log(`✅ Generated ${result.length} file update(s)`)

      const updatedContent = result[0].content

      // Parse and check specific packages
      const updatedJson = JSON.parse(updatedContent)
      console.log('\n🔍 Package versions check:')
      console.log(`- symfony/console: ${updatedJson.require['symfony/console']} (should be ^v7.3.1)`)
      console.log(`- laravel/framework: ${updatedJson.require['laravel/framework']} (should be ^10.0)`)
      console.log(`- doctrine/dbal: ${updatedJson.require['doctrine/dbal']} (should be ^3.0)`)

      // Check if other packages were incorrectly updated
      if (updatedJson.require['laravel/framework'] !== '^10.0') {
        console.log('❌ BUG: laravel/framework was incorrectly updated!')
      }
      if (updatedJson.require['doctrine/dbal'] !== '^3.0') {
        console.log('❌ BUG: doctrine/dbal was incorrectly updated!')
      }
      if (updatedJson.require['symfony/console'] === '^v7.3.1') {
        console.log('✅ symfony/console correctly updated')
      } else {
        console.log('❌ BUG: symfony/console was not updated correctly!')
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  }
}

runTest()
