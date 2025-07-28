import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import { generateComposerUpdates } from '../src/utils/composer-parser'

describe('Composer Individual Updates', () => {
  const mockComposerJson = {
    'require': {
      'php': '^8.1',
      'laravel/framework': '^10.0',
      'guzzlehttp/guzzle': '^7.0',
      'symfony/console': '^6.0',
      'monolog/monolog': '^3.0',
      'doctrine/dbal': '^3.0',
    },
    'require-dev': {
      'phpunit/phpunit': '^10.0',
    },
  }

  const mockComposerJsonString = JSON.stringify(mockComposerJson, null, 2)

  beforeEach(() => {
    // Mock fs.readFileSync to return our test composer.json
    spyOn(fs, 'readFileSync').mockReturnValue(mockComposerJsonString)
    spyOn(fs, 'existsSync').mockReturnValue(true)
  })

  it('should update ONLY the target package for individual major updates', async () => {
    // Test individual symfony/console update (should only change symfony/console)
    const symfonyUpdate = [
      { name: 'symfony/console', newVersion: 'v7.3.1', file: 'composer.json' },
    ]

    const result = await generateComposerUpdates(symfonyUpdate)

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('composer.json')

    const updatedContent = result[0].content
    const updatedJson = JSON.parse(updatedContent)

    // Should update ONLY symfony/console
    expect(updatedJson.require['symfony/console']).toBe('^v7.3.1')

    // Should NOT change other packages
    expect(updatedJson.require['laravel/framework']).toBe('^10.0') // NOT v12.21.0
    expect(updatedJson.require['doctrine/dbal']).toBe('^3.0') // NOT 4.3.1
    expect(updatedJson.require['guzzlehttp/guzzle']).toBe('^7.0') // unchanged
    expect(updatedJson.require['monolog/monolog']).toBe('^3.0') // unchanged
  })

  it('should update ONLY the target package for individual doctrine/dbal update', async () => {
    // Test individual doctrine/dbal update
    const doctrineUpdate = [
      { name: 'doctrine/dbal', newVersion: '4.3.1', file: 'composer.json' },
    ]

    const result = await generateComposerUpdates(doctrineUpdate)

    expect(result).toHaveLength(1)
    const updatedContent = result[0].content
    const updatedJson = JSON.parse(updatedContent)

    // Should update ONLY doctrine/dbal
    expect(updatedJson.require['doctrine/dbal']).toBe('^4.3.1')

    // Should NOT change other packages
    expect(updatedJson.require['symfony/console']).toBe('^6.0') // NOT v7.3.1
    expect(updatedJson.require['laravel/framework']).toBe('^10.0') // NOT v12.21.0
    expect(updatedJson.require['guzzlehttp/guzzle']).toBe('^7.0') // unchanged
  })

  it('should update ONLY the target package for individual laravel/framework update', async () => {
    // Test individual laravel/framework update
    const laravelUpdate = [
      { name: 'laravel/framework', newVersion: 'v12.21.0', file: 'composer.json' },
    ]

    const result = await generateComposerUpdates(laravelUpdate)

    expect(result).toHaveLength(1)
    const updatedContent = result[0].content
    const updatedJson = JSON.parse(updatedContent)

    // Should update ONLY laravel/framework
    expect(updatedJson.require['laravel/framework']).toBe('^v12.21.0')

    // Should NOT change other packages
    expect(updatedJson.require['symfony/console']).toBe('^6.0') // NOT v7.3.1
    expect(updatedJson.require['doctrine/dbal']).toBe('^3.0') // NOT 4.3.1
    expect(updatedJson.require['guzzlehttp/guzzle']).toBe('^7.0') // unchanged
  })

  it('should handle multiple updates correctly (for non-major grouped PRs)', async () => {
    // Test multiple updates (like in a non-major grouped PR)
    const multipleUpdates = [
      { name: 'symfony/console', newVersion: 'v7.3.1', file: 'composer.json' },
      { name: 'doctrine/dbal', newVersion: '4.3.1', file: 'composer.json' },
      { name: 'monolog/monolog', newVersion: '3.8.0', file: 'composer.json' },
    ]

    const result = await generateComposerUpdates(multipleUpdates)

    expect(result).toHaveLength(1)
    const updatedContent = result[0].content
    const updatedJson = JSON.parse(updatedContent)

    // Should update ALL specified packages
    expect(updatedJson.require['symfony/console']).toBe('^v7.3.1')
    expect(updatedJson.require['doctrine/dbal']).toBe('^4.3.1')
    expect(updatedJson.require['monolog/monolog']).toBe('^3.8.0')

    // Should NOT change unspecified packages
    expect(updatedJson.require['laravel/framework']).toBe('^10.0')
    expect(updatedJson.require['guzzlehttp/guzzle']).toBe('^7.0')
  })

  it('should preserve formatting and structure', async () => {
    const singleUpdate = [
      { name: 'symfony/console', newVersion: 'v7.3.1', file: 'composer.json' },
    ]

    const result = await generateComposerUpdates(singleUpdate)
    const updatedContent = result[0].content

    // Should be valid JSON
    expect(() => JSON.parse(updatedContent)).not.toThrow()

    // Should preserve structure
    const updatedJson = JSON.parse(updatedContent)
    expect(updatedJson.require).toBeDefined()
    expect(updatedJson['require-dev']).toBeDefined()
    expect(updatedJson['require-dev']['phpunit/phpunit']).toBe('^10.0') // unchanged
  })
})
