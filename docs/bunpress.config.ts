import type { BunPressConfig } from '@stacksjs/bunpress'

const config: BunPressConfig = {
  verbose: false,
  title: 'buddy-bot',
  description: 'The fastest, most intelligent dependency management bot for modern JavaScript and TypeScript projects',

  markdown: {},

  themeConfig: {
    colors: {
      primary: '#10b981',
    },

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Configuration', link: '/guide/configuration' },
      { text: 'PR Generation', link: '/guide/pr-generation' },
      { text: 'GitHub', link: 'https://github.com/stacksjs/buddy-bot' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/intro' },
            { text: 'Installation', link: '/install' },
            { text: 'Getting Started', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Configuration',
          items: [
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'PR Generation', link: '/guide/pr-generation' },
          ],
        },
      ],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Dependency Scanning', link: '/features/scanning' },
            { text: 'PR Creation', link: '/features/pr-creation' },
            { text: 'Dashboard', link: '/features/dashboard' },
            { text: 'Auto-Merge', link: '/features/auto-merge' },
          ],
        },
      ],
      '/advanced/': [
        {
          text: 'Advanced',
          items: [
            { text: 'Configuration', link: '/advanced/configuration' },
            { text: 'Plugins', link: '/advanced/plugins' },
            { text: 'Performance', link: '/advanced/performance' },
            { text: 'CI/CD Integration', link: '/advanced/ci-cd' },
          ],
        },
      ],
    },
  },
}

export default config
