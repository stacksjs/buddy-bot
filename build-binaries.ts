import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

/** A platform to ship a standalone binary for. */
interface Target {
  /** Bun's `--target` value */
  target: string
  /** Asset name, without the extension */
  name: string
  /** Executable suffix on that platform */
  suffix: string
}

/**
 * Platforms release assets are built for.
 *
 * These names are what the release workflow attaches, so changing one renames
 * a published asset — anything scripted against the old name breaks.
 */
export const TARGETS: Target[] = [
  { target: 'bun-linux-x64', name: 'buddy-bot-linux-x64', suffix: '' },
  { target: 'bun-linux-arm64', name: 'buddy-bot-linux-arm64', suffix: '' },
  { target: 'bun-windows-x64', name: 'buddy-bot-windows-x64', suffix: '.exe' },
  { target: 'bun-darwin-x64', name: 'buddy-bot-darwin-x64', suffix: '' },
  { target: 'bun-darwin-arm64', name: 'buddy-bot-darwin-arm64', suffix: '' },
]

const OUT_DIR = 'bin'

/** Run a command, returning its combined output and whether it succeeded. */
async function run(command: string[]): Promise<{ ok: boolean, output: string }> {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { ok: exitCode === 0, output: `${stdout}${stderr}`.trim() }
}

/**
 * Compile and zip a standalone binary for one platform.
 *
 * The binary is removed after zipping: five uncompressed Bun executables are
 * roughly half a gigabyte, and only the archives are ever uploaded.
 *
 * @param target - Platform to build for
 * @returns The archive path, or null when the build failed
 */
async function buildTarget(target: Target): Promise<string | null> {
  const binaryPath = join(OUT_DIR, `${target.name}${target.suffix}`)
  const archivePath = join(OUT_DIR, `${target.name}.zip`)

  const compiled = await run([
    // The Bun running this script, not whatever `bun` resolves to on PATH.
    // Cross-compilation downloads a runtime matching the compiler's version,
    // so an unreleased local Bun can only ever build its native target — and
    // picking up a different binary than the one invoked makes that failure
    // depend on shell setup rather than on anything visible here.
    process.execPath,
    'build',
    './bin/cli.ts',
    '--compile',
    `--target=${target.target}`,
    '--outfile',
    binaryPath,
    '--minify',
  ])

  if (!compiled.ok) {
    console.error(`✗ ${target.name}: compile failed\n${compiled.output}`)
    return null
  }

  // `-j` stores the file without its directory, so the archive contains just
  // the executable rather than a `bin/` folder the user has to dig through.
  await rm(archivePath, { force: true })
  const zipped = await run(['zip', '-jq', archivePath, binaryPath])

  if (!zipped.ok) {
    console.error(`✗ ${target.name}: zip failed\n${zipped.output}`)
    return null
  }

  await rm(binaryPath, { force: true })

  const size = (Bun.file(archivePath).size / 1024 / 1024).toFixed(1)
  console.log(`✓ ${target.name}.zip (${size} MB)`)

  return archivePath
}

/**
 * Build every release binary.
 *
 * Exits non-zero if any target fails. A release that quietly ships four of
 * five platforms looks complete while leaving one architecture with nothing to
 * download, which is worse than a failed build somebody has to look at.
 */
async function main(): Promise<void> {
  const only = process.argv.slice(2).filter(argument => !argument.startsWith('-'))
  const targets = only.length > 0
    ? TARGETS.filter(target => only.includes(target.name) || only.includes(target.target))
    : TARGETS

  if (targets.length === 0) {
    console.error(`No matching targets. Available: ${TARGETS.map(target => target.name).join(', ')}`)
    process.exit(1)
  }

  console.log(`Building ${targets.length} binar${targets.length === 1 ? 'y' : 'ies'}...`)

  const results = await Promise.all(targets.map(buildTarget))
  const failed = results.filter(result => result === null).length

  if (failed > 0) {
    console.error(`\n${failed} of ${targets.length} target(s) failed`)
    process.exit(1)
  }

  console.log(`\nBuilt ${results.length} binar${results.length === 1 ? 'y' : 'ies'} in ${OUT_DIR}/`)
}

if (import.meta.main)
  await main()
