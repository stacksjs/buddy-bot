import type { HeadConfig } from 'vitepress'
import { transformerTwoslash } from '@shikijs/vitepress-twoslash'
import { withPwa } from '@vite-pwa/vitepress'
import { defineConfig } from 'vitepress'

import vite from './vite.config'

// https://vitepress.dev/reference/site-config

const analyticsHead: HeadConfig[] = [
  [
    'script',
    {
      'src': 'https://cdn.usefathom.com/script.js',
      'data-site': 'KMFXMUFR',
      'defer': '',
    },
  ],
]

const nav = [
  { text: 'News', link: 'https://stacksjs.org/news' },
  {
    text: 'Changelog',
    link: 'https://github.com/stacksjs/buddy/blob/main/CHANGELOG.md',
  },
  // { text: 'Blog', link: 'https://updates.ow3.org' },
  {
    text: 'Resources',
    items: [
      { text: 'Team', link: '/team' },
      { text: 'Sponsors', link: '/sponsors' },
      { text: 'Partners', link: '/partners' },
      { text: 'Postcardware', link: '/postcardware' },
      { text: 'Stargazers', link: '/stargazers' },
      { text: 'License', link: '/license' },
      {
        items: [
          {
            text: 'Awesome Stacks',
            link: 'https://github.com/stacksjs/awesome-stacks',
          },
          {
            text: 'Contributing',
            link: 'https://github.com/stacksjs/stacks/blob/main/.github/CONTRIBUTING.md',
          },
        ],
      },
    ],
  },
]

const sidebar = [
  {
    text: 'Get Started',
    items: [
      { text: 'Intro', link: '/intro' },
      { text: 'Install', link: '/install' },
      { text: 'Usage', link: '/usage' },
      { text: 'Config', link: '/config' },
    ],
  },
  {
    text: 'Features',
    items: [
      { text: 'Dependency Scanning', link: '/features/scanning' },
      { text: 'Pull Request Generation', link: '/features/pull-requests' },
      { text: 'GitHub Actions Integration', link: '/features/github-actions' },
      { text: 'Update Strategies', link: '/features/update-strategies' },
      { text: 'Package Management', link: '/features/package-management' },
      { text: 'Labeling & Assignment', link: '/features/labeling-assignment' },
      { text: 'Release Notes', link: '/features/release-notes' },
    ],
  },
  {
    text: 'Advanced',
    items: [
      { text: 'Migration Guide', link: '/advanced/migration' },
      { text: 'Scheduling & Automation', link: '/advanced/scheduling' },
      { text: 'Monorepo Support', link: '/advanced/monorepo' },
      { text: 'Custom Workflows', link: '/advanced/custom-workflows' },
      { text: 'Security & Permissions', link: '/advanced/security' },
      { text: 'Performance & Optimization', link: '/advanced/performance' },
      { text: 'Docker Integration', link: '/advanced/docker' },
    ],
  },
  {
    text: 'API Reference',
    items: [
      { text: 'Buddy Class', link: '/api/buddy' },
      { text: 'Configuration Types', link: '/api/configuration' },
      { text: 'Git Providers', link: '/api/git-providers' },
      { text: 'Registry Client', link: '/api/registry-client' },
      { text: 'PR Generator', link: '/api/pr-generator' },
      { text: 'Scheduler', link: '/api/scheduler' },
    ],
  },
  {
    text: 'CLI Reference',
    items: [
      { text: 'Overview', link: '/cli/overview' },
      { text: 'Setup Commands', link: '/cli/setup' },
      { text: 'Update Commands', link: '/cli/update' },
      { text: 'Package Commands', link: '/cli/package' },
      { text: 'Utility Commands', link: '/cli/utility' },
    ],
  },
  { text: 'Showcase', link: '/Showcase' },
]
const description = 'A modern, fast reverse proxy. For a better local development environment.'
const title = 'ts-collect | A modern, fast reverse proxy. For a better local development environment.'

export default withPwa(
  defineConfig({
    lang: 'en-US',
    title: 'buddy',
    description,
    metaChunk: true,
    cleanUrls: true,
    lastUpdated: true,

    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: './images/logo-mini.svg' }],
      ['link', { rel: 'icon', type: 'image/png', href: './images/logo.png' }],
      ['meta', { name: 'theme-color', content: '#0A0ABC' }],
      ['meta', { name: 'title', content: title }],
      ['meta', { name: 'description', content: description }],
      ['meta', { name: 'author', content: 'Stacks.js, Inc.' }],
      ['meta', {
        name: 'tags',
        content: 'buddy, stacksjs, reverse proxy, modern, lightweight, zero-config, local development',
      }],

      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:locale', content: 'en' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],

      ['meta', { property: 'og:site_name', content: 'buddy' }],
      ['meta', { property: 'og:image', content: './images/og-image.png' }],
      ['meta', { property: 'og:url', content: 'https://reverse-proxy.sh/' }],
      // ['script', { 'src': 'https://cdn.usefathom.com/script.js', 'data-site': '', 'data-spa': 'auto', 'defer': '' }],
      ...analyticsHead,
    ],

    themeConfig: {
      search: {
        provider: 'local',
      },
      logo: {
        light: './images/logo-transparent.svg',
        dark: './images/logo-white-transparent.svg',
      },

      nav,
      sidebar,

      editLink: {
        pattern: 'https://github.com/stacksjs/stacks/edit/main/docs/docs/:path',
        text: 'Edit this page on GitHub',
      },

      footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright © 2025-present Stacks.js, Inc.',
      },

      socialLinks: [
        { icon: 'twitter', link: 'https://twitter.com/stacksjs' },
        { icon: 'bluesky', link: 'https://bsky.app/profile/chrisbreuer.dev' },
        { icon: 'github', link: 'https://github.com/stacksjs/buddy' },
        { icon: 'discord', link: 'https://discord.gg/stacksjs' },
      ],

      // algolia: services.algolia,

      // carbonAds: {
      //   code: '',
      //   placement: '',
      // },
    },

    pwa: {
      manifest: {
        theme_color: '#0A0ABC',
      },
    },

    markdown: {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },

      codeTransformers: [
        transformerTwoslash(),
      ],
    },

    vite,
  }),
)
