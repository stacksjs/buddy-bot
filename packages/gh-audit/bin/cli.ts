#!/usr/bin/env bun
import { audit } from '../src/engine'
import { formatGitHub } from '../src/reporters/github'
import { formatJson } from '../src/reporters/json'
import { formatPretty } from '../src/reporters/pretty'

interface Args {
  root: string
  format: 'pretty' | 'json' | 'github'
  ignore: string[]
  noColor: boolean
  showHelp: boolean
  showVersion: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    root: '.',
    format: detectDefaultFormat(),
    ignore: [],
    noColor: !!process.env.NO_COLOR,
    showHelp: false,
    showVersion: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') {
      args.showHelp = true
    }
    else if (a === '--version' || a === '-v') {
      args.showVersion = true
    }
    else if (a === '--format' || a === '-f') {
      const next = argv[++i]
      if (next !== 'pretty' && next !== 'json' && next !== 'github') {
        throw new Error(`Unknown --format ${next}. Use pretty | json | github.`)
      }
      args.format = next
    }
    else if (a.startsWith('--format=')) {
      const v = a.slice('--format='.length)
      if (v !== 'pretty' && v !== 'json' && v !== 'github')
        throw new Error(`Unknown --format ${v}. Use pretty | json | github.`)
      args.format = v
    }
    else if (a === '--ignore') {
      args.ignore.push(...argv[++i].split(','))
    }
    else if (a.startsWith('--ignore=')) {
      args.ignore.push(...a.slice('--ignore='.length).split(','))
    }
    else if (a === '--no-color') {
      args.noColor = true
    }
    else if (!a.startsWith('-')) {
      args.root = a
    }
    else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }

  return args
}

function detectDefaultFormat(): 'pretty' | 'json' | 'github' {
  // When invoked from a GitHub Actions runner, default to the
  // workflow-command format so findings surface as inline annotations.
  if (process.env.GITHUB_ACTIONS === 'true')
    return 'github'
  return 'pretty'
}

function help(): string {
  return `gh-audit — static analysis for GitHub Actions workflows

USAGE
  gh-audit [path] [options]

OPTIONS
  -f, --format <pretty|json|github>   Reporter (default: github when on a runner, pretty otherwise)
      --ignore <id,id,...>            Skip specific rule ids
      --no-color                      Disable ANSI colours in pretty output
  -h, --help                          Show this help
  -v, --version                       Show version

EXAMPLES
  gh-audit                            Audit .github/workflows in CWD
  gh-audit ../other-repo              Audit a different repo
  gh-audit --format json              Machine-readable output
  gh-audit --ignore missing-timeout   Disable a noisy rule
`
}

async function main(): Promise<void> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  }
  catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${help()}`)
    process.exit(2)
    return
  }

  if (args.showHelp) {
    process.stdout.write(help())
    return
  }
  if (args.showVersion) {
    const pkg = await Bun.file(`${import.meta.dir}/../package.json`).json() as { version: string }
    process.stdout.write(`${pkg.version}\n`)
    return
  }

  const result = await audit(args.root, { ignore: args.ignore })

  let output: string
  switch (args.format) {
    case 'json':
      output = formatJson(result)
      break
    case 'github':
      output = formatGitHub(result)
      break
    default:
      output = formatPretty(result, { color: !args.noColor })
  }
  if (output)
    process.stdout.write(`${output}\n`)

  process.exit(result.failed ? 1 : 0)
}

main().catch((err) => {
  process.stderr.write(`gh-audit: ${(err as Error).message}\n`)
  process.exit(2)
})
