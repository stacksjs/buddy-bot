#!/usr/bin/env bun

import { runFromProcess } from '../src/cli/commands'

// Run the CLI with process arguments
runFromProcess().catch((error) => {
  console.error('CLI Error:', error)
  process.exit(1)
})
