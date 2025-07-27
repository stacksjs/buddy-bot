---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "buddy-bot"
  text: "Intelligent Dependency Management"
  tagline: "Keep your dependencies up-to-date with automated pull requests."
  image: /images/logo-white.png
  actions:
    - theme: brand
      text: Interactive Setup
      link: /cli/setup
    - theme: alt
      text: Get Started
      link: /intro
    - theme: alt
      text: View on GitHub
      link: https://github.com/stacksjs/buddy-bot

features:
  - title: "Smart Scanning"
    icon: "🔍"
    details: "Automatically discovers outdated packages across your project using Bun's lightning-fast package manager, ts-pkgx for dependency files, and GitHub API for workflow actions."
  - title: "Automated PRs"
    icon: "🤖"
    details: "Creates professional pull requests with detailed release notes, impact analysis, and proper formatting."
  - title: "Dynamic Labels"
    icon: "🏷️"
    details: "Intelligently applies contextual labels based on update type, package ecosystem, and impact scope."
  - title: "Team Integration"
    icon: "👥"
    details: "Automatic reviewers and assignees based on package ownership and team configuration."
  - title: "Flexible Scheduling"
    icon: "📅"
    details: "Cron-based scheduling with GitHub Actions integration for automated dependency management."
  - title: "Smart Rebasing"
    icon: "🔄"
    details: "Interactive checkbox-based PR rebasing with conflict detection and resolution."
  - title: "Multi-Format Support"
    icon: "📦"
    details: "Group related packages for coordinated updates across package.json, pkgx, Launchpad dependency files, and GitHub Actions workflows."
  - title: "Security Focus"
    icon: "🛡️"
    details: "Prioritizes security updates with configurable strategies for different package types."
---

<Home />
