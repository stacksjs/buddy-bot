#!/usr/bin/env bun
/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { GitHubActionsTemplate } from '../templates/github-actions'

/**
 * Demo script to generate GitHub Actions workflows
 */
function generateWorkflowExamples() {
  const outputDir = resolve(process.cwd(), '.github', 'workflows')

  console.log('🚀 Generating GitHub Actions workflow examples...')

  try {
    mkdirSync(outputDir, { recursive: true })
  }
  catch {
    // Directory already exists
  }

  // Generate individual workflows
  const workflows = GitHubActionsTemplate.generateScheduledWorkflows()

  for (const [filename, content] of Object.entries(workflows)) {
    const filepath = resolve(outputDir, filename)
    writeFileSync(filepath, content)
    console.log(`✅ Generated: ${filename}`)
  }

  // Generate comprehensive workflow
  const comprehensiveWorkflow = GitHubActionsTemplate.generateComprehensiveWorkflow()
  writeFileSync(resolve(outputDir, 'buddy-comprehensive.yml'), comprehensiveWorkflow)
  console.log('✅ Generated: buddy-comprehensive.yml')

  // Generate Docker workflow
  const dockerWorkflow = GitHubActionsTemplate.generateDockerWorkflow()
  writeFileSync(resolve(outputDir, 'buddy-docker.yml'), dockerWorkflow)
  console.log('✅ Generated: buddy-docker.yml')

  // Generate Monorepo workflow
  const monorepoWorkflow = GitHubActionsTemplate.generateMonorepoWorkflow()
  writeFileSync(resolve(outputDir, 'buddy-monorepo.yml'), monorepoWorkflow)
  console.log('✅ Generated: buddy-monorepo.yml')

  console.log('\n🎉 All GitHub Actions workflows generated!')
  console.log('\n📁 Workflows saved to:', outputDir)
  console.log('\n💡 Next steps:')
  console.log('  1. Review the generated workflows')
  console.log('  2. Customize them for your project needs')
  console.log('  3. Set up required secrets (GITHUB_TOKEN)')
  console.log('  4. Enable GitHub Actions in your repository')
  console.log('\n🔗 Learn more: https://docs.github.com/en/actions')
}

/**
 * Demo function to show PR body generation
 */
async function demoPRFormatting() {
  console.log('\n🎨 Demo: Enhanced PR Formatting')
  console.log('========================================')

  const { PullRequestGenerator } = await import('../pr/pr-generator')

  // Mock update group for demo
  const mockUpdateGroup = {
    name: 'Dependencies',
    updateType: 'minor' as const,
    title: 'chore(deps): update dependencies',
    body: '',
    updates: [
      {
        name: 'typescript',
        currentVersion: '5.8.2',
        newVersion: '5.8.3',
        updateType: 'patch' as const,
        dependencyType: 'devDependencies' as const,
        file: 'package.json',
        metadata: undefined,
      },
      {
        name: '@types/node',
        currentVersion: '20.0.0',
        newVersion: '22.0.0',
        updateType: 'major' as const,
        dependencyType: 'devDependencies' as const,
        file: 'package.json',
        metadata: undefined,
      },
    ],
  }

  const generator = new PullRequestGenerator()

  console.log('📝 Sample PR Title:')
  console.log(`"${generator.generateTitle(mockUpdateGroup)}"`)

  console.log('\n📋 PR Body Preview:')
  console.log('─'.repeat(50))

  try {
    const body = await generator.generateBody(mockUpdateGroup)
    // Show first 500 chars of the body
    console.log(`${body.substring(0, 500)}...`)
    console.log('\n✅ Enhanced PR formatting includes:')
    console.log('  • Rich markdown tables with badges')
    console.log('  • Release notes from GitHub')
    console.log('  • Package statistics')
    console.log('  • Confidence indicators')
    console.log('  • Comparison links')
  }
  catch {
    console.log('⚠️  PR body generation demo (requires network access)')
    console.log('   In production, this would fetch real package data')
  }
}

/**
 * Demo scheduling functionality
 */
function demoScheduling() {
  console.log('\n⏰ Demo: Cron Scheduling')
  console.log('========================================')

  // eslint-disable-next-line ts/no-require-imports
  const { Scheduler } = require('../scheduler/scheduler')

  console.log('📅 Available schedule presets:')
  for (const [name, cron] of Object.entries(Scheduler.PRESETS)) {
    if (typeof cron === 'string') {
      console.log(`  • ${name.padEnd(15)} ${cron}`)
    }
  }

  console.log('\n🔧 Custom schedule examples:')
  console.log('  • Every 2 hours:     0 */2 * * *')
  console.log('  • Weekdays at 9 AM:  0 9 * * 1-5')
  console.log('  • 1st of month:      0 0 1 * *')

  console.log('\n💡 To start scheduler:')
  console.log('  buddy schedule --verbose')
  console.log('  buddy schedule --strategy patch')
}

// Run demos
if (import.meta.main) {
  console.log('🤖 Buddy Enhanced Features Demo')
  console.log('================================\n')

  generateWorkflowExamples()
  // eslint-disable-next-line antfu/no-top-level-await
  await demoPRFormatting()
  demoScheduling()

  console.log('\n🎯 Summary:')
  console.log('✅ Enhanced PR formatting with rich markdown')
  console.log('✅ Cron-based automated scheduling')
  console.log('✅ GitHub Actions integration templates')
  console.log('✅ Release notes and package statistics')
  console.log('\n🚀 Your Buddy dependency update tool is ready!')
}
