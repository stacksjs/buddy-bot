#!/usr/bin/env bun

import process from 'node:process'
import { runFromProcess } from '../src/cli/commands'

// Run the CLI with process arguments
runFromProcess().catch((error) => {
  console.error('CLI Error:', error)
  process.exit(1)
})
