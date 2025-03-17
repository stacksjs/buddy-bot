import { log } from '@stacksjs/cli'
import { findStacksProjects } from '@stacksjs/utils'
import { FolderWatcher } from './watch'
// import type { Ports } from '@stacksjs/types'

// eslint-disable-next-line antfu/no-top-level-await
const projects = await findStacksProjects(undefined, { quiet: true })

log.info(`Found ${projects.length} projects`)
log.info('Projects:', projects)

// need to loop over the projects and then trigger `buddy ports` for each project (which returns a list of ports)
// const projectsPorts: { [project: string]: Ports } = {}
// for (const project of projects) projectsPorts[project] = await getPortsForProjectPath(project, options)

// log.info('ProjectsPorts:', projectsPorts)

const watcher = new FolderWatcher({
  // mode is optional, defaults to 'interactive'
  paths: projects,

  ignoreDirs: [
    './src/generated',
    './config/secrets',
    './assets/raw',
  ],

  onError: (error) => {
    console.error('Watcher error:', error)
  },
})

// Start watching
watcher.start()
