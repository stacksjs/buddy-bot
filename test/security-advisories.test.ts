import type { PackageUpdate } from '../src/types'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import {
  advisoryKey,
  normalizeSeverity,
  SecurityAdvisoryService,
  toOsvEcosystem,
} from '../src/services/security-advisories'
import { formatSecurityAdvisorySection } from '../src/utils/security-format'
import { Logger } from '../src/utils/logger'

const logger = Logger.silent()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function update(overrides: Partial<PackageUpdate> = {}): PackageUpdate {
  return {
    name: 'lodash',
    currentVersion: '4.17.15',
    newVersion: '4.17.21',
    updateType: 'patch',
    dependencyType: 'dependencies',
    file: 'package.json',
    ...overrides,
  }
}

describe('security-advisories', () => {
  let fetchSpy: any

  afterEach(() => {
    fetchSpy?.mockRestore?.()
  })

  describe('toOsvEcosystem', () => {
    it('should map npm dependency kinds to npm', () => {
      expect(toOsvEcosystem('dependencies')).toBe('npm')
      expect(toOsvEcosystem('devDependencies')).toBe('npm')
      expect(toOsvEcosystem('peerDependencies')).toBe('npm')
      expect(toOsvEcosystem('optionalDependencies')).toBe('npm')
    })

    it('should map composer dependency kinds to Packagist', () => {
      expect(toOsvEcosystem('require')).toBe('Packagist')
      expect(toOsvEcosystem('require-dev')).toBe('Packagist')
    })

    it('success case - indexes GitHub Actions', () => {
      // An action runs with the workflow's credentials, so a compromised one
      // is a repository compromise.
      expect(toOsvEcosystem('github-actions')).toBe('GitHub Actions')
    })

    it('edge case - returns null for kinds OSV does not index', () => {
      expect(toOsvEcosystem('docker-image')).toBeNull()
      expect(toOsvEcosystem('zig-dependencies')).toBeNull()
    })
  })

  describe('normalizeSeverity', () => {
    it('should read the GitHub-style word severity', () => {
      expect(normalizeSeverity({ id: 'a', database_specific: { severity: 'CRITICAL' } } as any)).toBe('critical')
      expect(normalizeSeverity({ id: 'a', database_specific: { severity: 'moderate' } } as any)).toBe('moderate')
    })

    it('should normalize "medium" onto "moderate"', () => {
      expect(normalizeSeverity({ id: 'a', database_specific: { severity: 'MEDIUM' } } as any)).toBe('moderate')
    })

    it('should bucket a numeric CVSS score', () => {
      expect(normalizeSeverity({ id: 'a', severity: [{ type: 'CVSS_V3', score: '9.8' }] } as any)).toBe('critical')
      expect(normalizeSeverity({ id: 'a', severity: [{ type: 'CVSS_V3', score: '7.5' }] } as any)).toBe('high')
      expect(normalizeSeverity({ id: 'a', severity: [{ type: 'CVSS_V3', score: '5.0' }] } as any)).toBe('moderate')
      expect(normalizeSeverity({ id: 'a', severity: [{ type: 'CVSS_V3', score: '2.1' }] } as any)).toBe('low')
    })

    it('edge case - defaults to moderate when severity is absent', () => {
      expect(normalizeSeverity({ id: 'a' } as any)).toBe('moderate')
    })
  })

  describe('advisoryKey', () => {
    it('should produce a stable ecosystem/name/version key', () => {
      expect(advisoryKey({ name: 'lodash', version: '4.17.15', ecosystem: 'npm' }))
        .toBe('npm:lodash@4.17.15')
    })

    it('edge case - keeps scoped package names intact', () => {
      expect(advisoryKey({ name: '@acme/ui', version: '1.0.0', ecosystem: 'npm' }))
        .toBe('npm:@acme/ui@1.0.0')
    })
  })

  describe('findAdvisories', () => {
    it('success case - resolves advisories for a vulnerable version', async () => {
      fetchSpy = (spyOn(globalThis, 'fetch') as any).mockImplementation(async (url: any) => {
        if (String(url).includes('querybatch'))
          return jsonResponse({ results: [{ vulns: [{ id: 'GHSA-test-1111' }] }] })
        return jsonResponse({
          id: 'GHSA-test-1111',
          aliases: ['CVE-2021-23337'],
          summary: 'Command injection in lodash',
          database_specific: { severity: 'HIGH' },
          affected: [{
            package: { name: 'lodash', ecosystem: 'npm' },
            ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
          }],
        })
      })

      const service = new SecurityAdvisoryService(logger)
      const result = await service.findAdvisories([
        { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
      ])

      const advisories = result.get('npm:lodash@4.17.15')
      expect(advisories).toHaveLength(1)
      expect(advisories![0].id).toBe('GHSA-test-1111')
      expect(advisories![0].severity).toBe('high')
      expect(advisories![0].fixedVersion).toBe('4.17.21')
      expect(advisories![0].aliases).toEqual(['CVE-2021-23337'])
    })

    it('success case - returns an empty map when nothing is vulnerable', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ results: [{}] }))

      const service = new SecurityAdvisoryService(logger)
      const result = await service.findAdvisories([
        { name: 'lodash', version: '4.17.21', ecosystem: 'npm' },
      ])

      expect(result.size).toBe(0)
    })

    it('edge case - short-circuits on an empty query list', async () => {
      fetchSpy = spyOn(globalThis, 'fetch')

      const service = new SecurityAdvisoryService(logger)
      expect((await service.findAdvisories([])).size).toBe(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('failure case - degrades to empty when OSV is unreachable', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))

      const service = new SecurityAdvisoryService(logger)
      const result = await service.findAdvisories([
        { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
      ])

      expect(result.size).toBe(0)
    })

    it('failure case - degrades to empty on an OSV error status', async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, 500))

      const service = new SecurityAdvisoryService(logger)
      const result = await service.findAdvisories([
        { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
      ])

      expect(result.size).toBe(0)
    })
  })

  describe('annotateUpdates', () => {
    function mockOsv(fixedVersion: string | undefined, severity = 'HIGH') {
      return (spyOn(globalThis, 'fetch') as any).mockImplementation(async (url: any) => {
        if (String(url).includes('querybatch'))
          return jsonResponse({ results: [{ vulns: [{ id: 'GHSA-x' }] }] })
        return jsonResponse({
          id: 'GHSA-x',
          summary: 'Vulnerable',
          database_specific: { severity },
          affected: fixedVersion
            ? [{ package: { name: 'lodash' }, ranges: [{ events: [{ fixed: fixedVersion }] }] }]
            : [],
        })
      })
    }

    it('success case - annotates an update that reaches the fixed version', async () => {
      fetchSpy = mockOsv('4.17.21')

      const updates = [update()]
      await new SecurityAdvisoryService(logger).annotateUpdates(updates)

      expect(updates[0].securityAdvisories).toHaveLength(1)
      expect(updates[0].securityAdvisories![0].id).toBe('GHSA-x')
    })

    it('edge case - skips an advisory the update does not actually fix', async () => {
      fetchSpy = mockOsv('5.0.0')

      const updates = [update()]
      await new SecurityAdvisoryService(logger).annotateUpdates(updates)

      expect(updates[0].securityAdvisories).toBeUndefined()
    })

    it('edge case - skips an advisory with no stated fix', async () => {
      fetchSpy = mockOsv(undefined)

      const updates = [update()]
      await new SecurityAdvisoryService(logger).annotateUpdates(updates)

      expect(updates[0].securityAdvisories).toBeUndefined()
    })

    it('should drop advisories below the minimum severity', async () => {
      fetchSpy = mockOsv('4.17.21', 'LOW')

      const updates = [update()]
      await new SecurityAdvisoryService(logger).annotateUpdates(updates, 'high')

      expect(updates[0].securityAdvisories).toBeUndefined()
    })

    it('should not query OSV for ecosystems it does not index', async () => {
      fetchSpy = spyOn(globalThis, 'fetch')

      const updates = [update({ dependencyType: 'docker-image', name: 'node' })]
      await new SecurityAdvisoryService(logger).annotateUpdates(updates)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(updates[0].securityAdvisories).toBeUndefined()
    })

    it('should strip the v prefix from an action version', async () => {
      // OSV indexes GitHub Actions as `4`, not `v4`; sending the written form
      // matches nothing and would read as "no advisories".
      fetchSpy = mockOsv('4.2.2')

      await new SecurityAdvisoryService(logger).annotateUpdates([
        update({ dependencyType: 'github-actions', name: 'actions/checkout', currentVersion: 'v4', newVersion: 'v4.2.2' }),
      ])

      const batch = fetchSpy.mock.calls.find((call: any) => String(call[0]).includes('querybatch'))
      const body = JSON.parse(String((batch![1] as RequestInit).body))
      expect(body.queries[0]).toMatchObject({
        version: '4',
        package: { name: 'actions/checkout', ecosystem: 'GitHub Actions' },
      })
    })

    it('should query the lower bound of a caret range', async () => {
      fetchSpy = mockOsv('4.17.21')

      await new SecurityAdvisoryService(logger).annotateUpdates([
        update({ currentVersion: '^4.17.15' }),
      ])

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
      expect(body.queries[0].version).toBe('4.17.15')
    })
  })

  describe('formatSecurityAdvisorySection', () => {
    it('edge case - renders nothing when no update carries an advisory', () => {
      expect(formatSecurityAdvisorySection([update()])).toBe('')
    })

    it('success case - renders a table row per advisory', () => {
      const section = formatSecurityAdvisorySection([
        update({
          securityAdvisories: [{
            id: 'GHSA-x',
            aliases: ['CVE-1'],
            summary: 'Bad thing',
            severity: 'critical',
            url: 'https://osv.dev/vulnerability/GHSA-x',
            fixedVersion: '4.17.21',
          }],
        }),
      ])

      expect(section).toContain('Security Advisories')
      expect(section).toContain('🔴 Critical')
      expect(section).toContain('[GHSA-x](https://osv.dev/vulnerability/GHSA-x)')
      expect(section).toContain('CVE-1')
      expect(section).toContain('`lodash`')
    })

    it('edge case - escapes pipes so the table survives', () => {
      const section = formatSecurityAdvisorySection([
        update({
          securityAdvisories: [{
            id: 'GHSA-y',
            aliases: [],
            summary: 'a | b',
            severity: 'low',
            fixedVersion: '1.0.0',
          }],
        }),
      ])

      expect(section).toContain('a \\| b')
    })

    it('edge case - flattens multi-line summaries onto one row', () => {
      const section = formatSecurityAdvisorySection([
        update({
          securityAdvisories: [{
            id: 'GHSA-z',
            aliases: [],
            summary: 'first line\nsecond line',
            severity: 'low',
            fixedVersion: '1.0.0',
          }],
        }),
      ])

      const rows = section.split('\n').filter(line => line.startsWith('| `lodash`'))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toContain('first line second line')
    })
  })
})
