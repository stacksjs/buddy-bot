import process from 'node:process'
import { CAC } from 'cac'
import { version } from '../package.json'

const cli = new CAC('buddy-bot')

// Define CLI options interface to match our core types
interface CLIOptions {
  from?: string
  to?: string
  keyPath?: string
  certPath?: string
  caCertPath?: string
  hostsCleanup?: boolean
  certsCleanup?: boolean
  startCommand?: string
  startCwd?: string
  startEnv?: string
  changeOrigin?: boolean
  verbose?: boolean
}

cli
  .command('start', 'Start the Reverse Proxy Server')
  .option('--from <from>', 'The URL to proxy from')
  .option('--to <to>', 'The URL to proxy to')
  .option('--key-path <path>', 'Absolute path to the SSL key')
  .option('--cert-path <path>', 'Absolute path to the SSL certificate')
  .option('--ca-cert-path <path>', 'Absolute path to the SSL CA certificate')
  .option('--hosts-cleanup', 'Cleanup /etc/hosts on exit')
  .option('--certs-cleanup', 'Cleanup SSL certificates on exit')
  .option('--start-command <command>', 'Command to start the dev server')
  .option('--start-cwd <path>', 'Current working directory for the dev server')
  .option('--start-env <env>', 'Environment variables for the dev server')
  .option('--change-origin', 'Change the origin of the host header to the target URL')
  .option('--verbose', 'Enable verbose logging')
  .example('rpx start --from localhost:5173 --to my-project.localhost')
  .example('rpx start --from localhost:3000 --to my-project.localhost/api')
  .example('rpx start --from localhost:3000 --to localhost:3001')
  .example('rpx start --from localhost:5173 --to my-project.test --key-path /absolute/path/to/key --cert-path /absolute/path/to/cert')
  .example('rpx start --from localhost:5173 --to my-project.localhost --change-origin')
  .action(async (options?: CLIOptions) => {
    if (!options?.from || !options.to) {
      return startProxies(config)
    }

    // Convert CLI options to ProxyOption
    const proxyOptions: ProxyOption = {
      from: options.from,
      to: options.to,
      https: {
        keyPath: options.keyPath,
        certPath: options.certPath,
        caCertPath: options.caCertPath,
      },
      cleanup: {
        certs: options.certsCleanup || false,
        hosts: options.hostsCleanup || false,
      },
      verbose: options.verbose || false,
      changeOrigin: options.changeOrigin || false,
    }

    // Add start options if provided
    if (options.startCommand) {
      const startOptions: StartOptions = {
        command: options.startCommand,
      }
      if (options.startCwd)
        startOptions.cwd = options.startCwd
      if (options.startEnv) {
        try {
          startOptions.env = JSON.parse(options.startEnv)
        }
        catch (err) {
          console.error('Failed to parse start-env JSON:', err)
          process.exit(1)
        }
      }
      proxyOptions.start = startOptions
    }

    return startProxy(proxyOptions)
  })

cli.command('version', 'Show the version of the Reverse Proxy CLI').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
