import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RegistryClient } from '../src/registry/registry-client'
import { PackageScanner } from '../src/scanner/package-scanner'
import { Logger } from '../src/utils/logger'
import { shouldSkipPackageDirectory } from '../src/utils/package-paths'

const generatedDirectories = [
  'bower_components',
  'node_modules',
  'pantry',
  'ts-pantry',
  'vendor',
]

describe('generated dependency directory filtering', () => {
  const temporaryDirectories: string[] = []
  const logger = Logger.quiet()

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ))
  })

  it('classifies package-manager install trees as generated', () => {
    for (const directory of generatedDirectories)
      expect(shouldSkipPackageDirectory(directory)).toBe(true)

    expect(shouldSkipPackageDirectory('packages')).toBe(false)
  })

  it('excludes generated manifests from both package discovery paths', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'buddy-generated-dependencies-'))
    temporaryDirectories.push(projectPath)

    await writePackageJson(projectPath, 'package.json', 'root')
    await writePackageJson(projectPath, 'packages/app/package.json', 'app')

    for (const directory of generatedDirectories)
      await writePackageJson(projectPath, `${directory}/cached/package.json`, `generated-${directory}`)

    const scanner = new PackageScanner(projectPath, logger)
    const scannedPaths = (await scanner.scanProject()).map(file => file.path)

    const registryClient = new RegistryClient(projectPath, logger)
    const registryPaths = await (registryClient as any).findPackageJsonFiles()

    expect(scannedPaths.filter(path => path.endsWith('package.json')).sort()).toEqual([
      'package.json',
      'packages/app/package.json',
    ])
    expect(registryPaths.sort()).toEqual([
      'package.json',
      'packages/app/package.json',
    ])
  })
})

async function writePackageJson(projectPath: string, relativePath: string, name: string): Promise<void> {
  const filePath = join(projectPath, relativePath)
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, JSON.stringify({
    name,
    dependencies: {
      acorn: '^8.0.0',
    },
  }))
}
