import type { BuddyBotConfig, PackageUpdate, UpdateGroup } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { Buddy } from '../src/buddy'
import { PullRequestGenerator } from '../src/pr/pr-generator'
import { stripManifest } from '../src/pr/pr-manifest'
import { applyTemplate, templateTokensForGroup } from '../src/pr/templates'
import { Scheduler } from '../src/scheduler/scheduler'

function makeUpdate(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'typescript',
    currentVersion: '5.8.2',
    newVersion: '5.8.3',
    updateType: 'patch',
    dependencyType: 'devDependencies',
    file: 'package.json',
    ...overrides,
  }
}

function makeGroup(updates: PackageUpdate[] = [makeUpdate()]): UpdateGroup {
  return {
    name: 'Non-Major Updates',
    title: 'chore(deps): update all non-major dependencies',
    body: '',
    updateType: 'patch',
    updates,
  }
}

function makeGenerator(config: BuddyBotConfig): PullRequestGenerator {
  const generator = new PullRequestGenerator(config) as any
  generator.releaseNotesFetcher.fetchPackageInfo = async () => null
  return generator
}

describe('previously unread configuration options', () => {
  describe('packages.pin', () => {
    it('success case - drops updates for a package already at its pin', () => {
      const buddy = new Buddy({ packages: { strategy: 'all', pin: { typescript: '5.8.2' } } }) as any

      const result = buddy.applyPins([makeUpdate()])

      expect(result).toEqual([])
    })

    it('success case - retargets a package that drifted off its pin', () => {
      const buddy = new Buddy({ packages: { strategy: 'all', pin: { typescript: '5.8.2' } } }) as any

      const result = buddy.applyPins([makeUpdate({ currentVersion: '5.7.0', newVersion: '5.9.0' })])

      expect(result).toHaveLength(1)
      expect(result[0].newVersion).toBe('5.8.2')
      expect(result[0].updateType).toBe('minor')
    })

    it('success case - leaves unpinned packages untouched', () => {
      const buddy = new Buddy({ packages: { strategy: 'all', pin: { other: '1.0.0' } } }) as any

      expect(buddy.applyPins([makeUpdate()])).toHaveLength(1)
    })

    it('edge case - no pins configured is a pass-through', () => {
      const buddy = new Buddy({ packages: { strategy: 'all' } }) as any

      expect(buddy.applyPins([makeUpdate()])).toHaveLength(1)
    })
  })

  describe('pullRequest.titleFormat', () => {
    it('success case - wraps the generated title', () => {
      const buddy = new Buddy({
        packages: { strategy: 'all' },
        pullRequest: { titleFormat: '[deps] {title}' },
      }) as any

      expect(buddy.prTitleFor(makeGroup())).toBe('[deps] chore(deps): update all non-major dependencies')
    })

    it('success case - exposes group metadata as tokens', () => {
      const buddy = new Buddy({
        packages: { strategy: 'patch' },
        pullRequest: { titleFormat: '{group}: {count} package(s) [{strategy}]' },
      }) as any

      expect(buddy.prTitleFor(makeGroup())).toBe('Non-Major Updates: 1 package(s) [patch]')
    })

    it('edge case - falls back to the generated title with no template', () => {
      const buddy = new Buddy({ packages: { strategy: 'all' } }) as any

      expect(buddy.prTitleFor(makeGroup())).toBe('chore(deps): update all non-major dependencies')
    })
  })

  describe('pullRequest.commitMessageFormat', () => {
    it('success case - applies the template and keeps the lifecycle suffix', () => {
      const buddy = new Buddy({
        packages: { strategy: 'all' },
        pullRequest: { commitMessageFormat: 'deps: {message}' },
      }) as any

      expect(buddy.commitMessageFor(makeGroup(), '(rebased)'))
        .toBe('deps: chore(deps): update all non-major dependencies (rebased)')
    })

    it('edge case - falls back to the group title', () => {
      const buddy = new Buddy({ packages: { strategy: 'all' } }) as any

      expect(buddy.commitMessageFor(makeGroup())).toBe('chore(deps): update all non-major dependencies')
    })
  })

  describe('pullRequest.bodyTemplate', () => {
    it('success case - replaces the generated prose', async () => {
      const body = await makeGenerator({
        packages: { strategy: 'all' },
        pullRequest: { bodyTemplate: '# Custom\n\n{package_count} update(s) in {group}\n\n{footer}' },
      }).generateBody(makeGroup())

      expect(body).toContain('# Custom')
      expect(body).toContain('1 update(s) in Non-Major Updates')
      expect(body).not.toContain('### Configuration')
    })

    it('success case - keeps the rebase checkbox and manifest', async () => {
      const body = await makeGenerator({
        packages: { strategy: 'all' },
        pullRequest: { bodyTemplate: 'Only this. {footer}' },
      }).generateBody(makeGroup())

      // Custom templates must not be able to break the PR lifecycle.
      expect(body).toContain('<!-- rebase-check -->')
      expect(body).toContain('buddy-bot:manifest')
    })

    it('edge case - leaves unknown tokens intact rather than blanking them', () => {
      const rendered = applyTemplate('{group} {nonsense}', templateTokensForGroup(makeGroup()))

      expect(rendered).toBe('Non-Major Updates {nonsense}')
    })
  })

  describe('releaseNotes options', () => {
    it('success case - enabled:false omits the release notes section', async () => {
      const body = await makeGenerator({
        packages: { strategy: 'all' },
        releaseNotes: { enabled: false },
      }).generateBody(makeGroup())

      expect(body).not.toContain('### Release Notes')
      // The body is still complete and rebasable.
      expect(body).toContain('<!-- rebase-check -->')
      expect(stripManifest(body).length).toBeGreaterThan(0)
    })

    it('success case - enabled defaults to on', async () => {
      const body = await makeGenerator({ packages: { strategy: 'all' } }).generateBody(makeGroup())

      expect(body).toContain('### Release Notes')
    })
  })

  describe('schedule.timezone', () => {
    it('success case - shifts the next run into the configured zone', () => {
      const scheduler = new Scheduler() as any

      const utc = scheduler.parseCronExpression('0 9 * * *', 'UTC')
      const tokyo = scheduler.parseCronExpression('0 9 * * *', 'Asia/Tokyo')

      // 09:00 Tokyo is nine hours before 09:00 UTC on the same day, so the two
      // next-run instants must differ.
      expect(utc.getTime()).not.toBe(tokyo.getTime())
    })

    it('failure case - an unknown zone falls back to host time', () => {
      const scheduler = new Scheduler() as any

      const withBadZone = scheduler.parseCronExpression('0 9 * * *', 'Not/AZone')
      const withoutZone = scheduler.parseCronExpression('0 9 * * *')

      expect(withBadZone.getTime()).toBe(withoutZone.getTime())
    })
  })
})
