import { describe, expect, it } from 'bun:test'
import { getUpdateType } from '../src/utils/helpers'

describe('Version Classification', () => {
  describe('getUpdateType', () => {
    it('should correctly identify major updates', () => {
      expect(getUpdateType('1.0.0', '2.0.0')).toBe('major')
      expect(getUpdateType('0.14.1', '1.0.0')).toBe('major')
      expect(getUpdateType('2.5.3', '3.0.0')).toBe('major')
    })

    it('should correctly identify minor updates', () => {
      expect(getUpdateType('1.0.0', '1.1.0')).toBe('minor')
      expect(getUpdateType('0.14.1', '0.15.0')).toBe('minor')
      expect(getUpdateType('0.14.1', '0.15.1')).toBe('minor')
      expect(getUpdateType('0.14.1', '0.16.3')).toBe('minor')
      expect(getUpdateType('2.5.3', '2.6.0')).toBe('minor')
      expect(getUpdateType('1.2.0', '1.3.5')).toBe('minor')
    })

    it('should correctly identify patch updates', () => {
      expect(getUpdateType('1.0.0', '1.0.1')).toBe('patch')
      expect(getUpdateType('0.14.1', '0.14.2')).toBe('patch')
      expect(getUpdateType('2.5.3', '2.5.4')).toBe('patch')
      expect(getUpdateType('1.2.3', '1.2.10')).toBe('patch')
    })

    it('should handle version prefixes correctly', () => {
      expect(getUpdateType('^1.0.0', '1.1.0')).toBe('minor')
      expect(getUpdateType('~1.0.0', '1.0.1')).toBe('patch')
      expect(getUpdateType('v1.0.0', 'v2.0.0')).toBe('major')
      expect(getUpdateType('@1.0.0', '1.1.0')).toBe('minor')
      expect(getUpdateType('>=1.0.0', '1.1.0')).toBe('minor')
    })

    it('should handle edge cases', () => {
      // Same version should be patch (no-op)
      expect(getUpdateType('1.0.0', '1.0.0')).toBe('patch')

      // Downgrade should be patch
      expect(getUpdateType('1.1.0', '1.0.0')).toBe('patch')

      // Two-part versions
      expect(getUpdateType('1.0', '1.1')).toBe('minor')
      expect(getUpdateType('1.0', '2.0')).toBe('major')
    })

    it('should handle the specific bunfig case from PR #125', () => {
      // This was incorrectly classified as major but should be minor
      expect(getUpdateType('0.14.1', '0.15.0')).toBe('minor')
      expect(getUpdateType('0.14.1', '0.15.1')).toBe('minor')
    })
  })
})
