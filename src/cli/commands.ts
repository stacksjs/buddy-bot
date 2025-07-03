import { runCLI } from './cli'

/**
 * Run a command with the given arguments
 */
export async function runCommand(command: string, args: string[] = []): Promise<void> {
  await runCLI([command, ...args])
}

/**
 * Run CLI with process arguments
 */
export async function runFromProcess(): Promise<void> {
  const args = process.argv.slice(2)
  await runCLI(args)
}
