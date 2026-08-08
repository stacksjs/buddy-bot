import type { PackageUpdate, SecurityAdvisory } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { groupUpdates, sortUpdatesByPriority } from '../src/utils/helpers'

function advisory(severity: SecurityAdvisory['severity']): SecurityAdvisory {
  return {
    id: `GHSA-${severity}`,
    aliases: [],
    summary: `${severity} issue`,
    severity,
    fixedVersion: '1.0.0',
  }
}

function update(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'pkg',
    currentVersion: '1.0.0',
    newVersion: '1.0.1',
    updateType: 'patch',
    dependencyType: 'dependencies',
    file: 'package.json',
    ...overrides,
  }
}

describe('security prioritization', () => {
  describe('sortUpdatesByPriority', () => {
    it('should float advisory fixes above a major bump', () => {
      const sorted = sortUpdatesByPriority([
        update({ name: 'routine-major', updateType: 'major' }),
        update({ name: 'vulnerable', securityAdvisories: [advisory('moderate')] }),
      ])

      expect(sorted[0].name).toBe('vulnerable')
    })

    it('should order advisory fixes by severity', () => {
      const sorted = sortUpdatesByPriority([
        update({ name: 'low-risk', securityAdvisories: [advisory('low')] }),
        update({ name: 'critical-risk', securityAdvisories: [advisory('critical')] }),
        update({ name: 'high-risk', securityAdvisories: [advisory('high')] }),
      ])

      expect(sorted.map(u => u.name)).toEqual(['critical-risk', 'high-risk', 'low-risk'])
    })

    it('should rank by the most severe advisory on an update', () => {
      const sorted = sortUpdatesByPriority([
        update({ name: 'single-high', securityAdvisories: [advisory('high')] }),
        update({ name: 'mixed', securityAdvisories: [advisory('low'), advisory('critical')] }),
      ])

      expect(sorted[0].name).toBe('mixed')
    })

    it('should preserve major > minor > patch among non-security updates', () => {
      const sorted = sortUpdatesByPriority([
        update({ name: 'c', updateType: 'patch' }),
        update({ name: 'a', updateType: 'major' }),
        update({ name: 'b', updateType: 'minor' }),
      ])

      expect(sorted.map(u => u.name)).toEqual(['a', 'b', 'c'])
    })

    it('should leave ordering untouched when prioritizeSecurity is off', () => {
      const sorted = sortUpdatesByPriority([
        update({ name: 'vulnerable', securityAdvisories: [advisory('critical')] }),
        update({ name: 'routine-major', updateType: 'major' }),
      ], { prioritizeSecurity: false })

      expect(sorted[0].name).toBe('routine-major')
    })
  })

  describe('groupUpdates', () => {
    it('should emit a Security Updates group first', () => {
      const groups = groupUpdates([
        update({ name: 'routine', updateType: 'minor' }),
        update({ name: 'vulnerable', securityAdvisories: [advisory('high')] }),
      ])

      expect(groups[0].name).toBe('Security Updates')
      expect(groups[0].updates.map(u => u.name)).toEqual(['vulnerable'])
    })

    it('should not repeat a security update in the ecosystem groups', () => {
      const groups = groupUpdates([
        update({ name: 'routine', updateType: 'minor' }),
        update({ name: 'vulnerable', securityAdvisories: [advisory('high')] }),
      ])

      const nonSecurity = groups.filter(g => g.name !== 'Security Updates')
      const names = nonSecurity.flatMap(g => g.updates.map(u => u.name))
      expect(names).not.toContain('vulnerable')
    })

    it('should title the security group as a fix, not a chore', () => {
      const groups = groupUpdates([
        update({ name: 'vulnerable', securityAdvisories: [advisory('critical')] }),
      ])

      expect(groups[0].title).toBe('fix(deps): update vulnerable dependencies')
    })

    it('should describe the advisories in the security group body', () => {
      const groups = groupUpdates([
        update({ name: 'vulnerable', securityAdvisories: [advisory('critical')] }),
      ])

      expect(groups[0].body).toContain('Security Advisories')
      expect(groups[0].body).toContain('GHSA-critical')
    })

    it('edge case - emits no security group when nothing is vulnerable', () => {
      const groups = groupUpdates([update({ name: 'routine', updateType: 'minor' })])

      expect(groups.some(g => g.name === 'Security Updates')).toBe(false)
    })

    it('should keep security updates inline when prioritizeSecurity is off', () => {
      const groups = groupUpdates([
        update({ name: 'vulnerable', updateType: 'minor', securityAdvisories: [advisory('high')] }),
      ], { prioritizeSecurity: false })

      expect(groups.some(g => g.name === 'Security Updates')).toBe(false)
      expect(groups.flatMap(g => g.updates.map(u => u.name))).toContain('vulnerable')
    })
  })
})
