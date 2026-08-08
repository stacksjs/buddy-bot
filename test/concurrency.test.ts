import { describe, expect, it } from 'bun:test'
import { AsyncMemo, chunk, DEFAULT_CONCURRENCY, mapWithConcurrency } from '../src/utils/concurrency'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('concurrency', () => {
  describe('mapWithConcurrency', () => {
    it('success case - preserves input order', async () => {
      const result = await mapWithConcurrency(
        [30, 10, 20, 0],
        async (ms) => {
          await delay(ms)
          return ms
        },
        4,
      )

      expect(result).toEqual([30, 10, 20, 0])
    })

    it('edge case - returns an empty array for no input', async () => {
      expect(await mapWithConcurrency([], async x => x)).toEqual([])
    })

    it('should never exceed the concurrency limit', async () => {
      let inFlight = 0
      let peak = 0

      await mapWithConcurrency(
        Array.from({ length: 25 }, (_, i) => i),
        async (value) => {
          inFlight++
          peak = Math.max(peak, inFlight)
          await delay(1)
          inFlight--
          return value
        },
        4,
      )

      expect(peak).toBeLessThanOrEqual(4)
      expect(peak).toBeGreaterThan(1)
    })

    it('should process every item', async () => {
      const items = Array.from({ length: 50 }, (_, i) => i)
      const result = await mapWithConcurrency(items, async i => i * 2, 6)

      expect(result).toHaveLength(50)
      expect(result[49]).toBe(98)
    })

    it('should pass the original index to the worker', async () => {
      const result = await mapWithConcurrency(['a', 'b', 'c'], async (item, index) => `${index}:${item}`, 2)

      expect(result).toEqual(['0:a', '1:b', '2:c'])
    })

    it('failure case - a rejected worker rejects the call', async () => {
      const promise = mapWithConcurrency(
        [1, 2, 3],
        async (value) => {
          if (value === 2)
            throw new Error('boom')
          return value
        },
        2,
      )

      await expect(promise).rejects.toThrow('boom')
    })

    it('edge case - clamps a concurrency below one', async () => {
      expect(await mapWithConcurrency([1, 2], async x => x, 0)).toEqual([1, 2])
    })

    it('should expose a sane default concurrency', () => {
      expect(DEFAULT_CONCURRENCY).toBeGreaterThan(1)
    })
  })

  describe('chunk', () => {
    it('success case - splits evenly', () => {
      expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
    })

    it('edge case - last chunk may be short', () => {
      expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    })

    it('edge case - empty input yields no chunks', () => {
      expect(chunk([], 5)).toEqual([])
    })

    it('edge case - clamps a size below one', () => {
      expect(chunk([1, 2], 0)).toEqual([[1], [2]])
    })

    it('should return a single chunk when size exceeds length', () => {
      expect(chunk([1, 2], 10)).toEqual([[1, 2]])
    })
  })

  describe('AsyncMemo', () => {
    it('success case - invokes the factory once per key', async () => {
      const memo = new AsyncMemo<number>()
      let calls = 0
      const factory = async () => {
        calls++
        return 42
      }

      expect(await memo.get('a', factory)).toBe(42)
      expect(await memo.get('a', factory)).toBe(42)
      expect(calls).toBe(1)
    })

    it('should deduplicate concurrent requests for the same key', async () => {
      const memo = new AsyncMemo<number>()
      let calls = 0
      const factory = async () => {
        calls++
        await delay(5)
        return 1
      }

      await Promise.all([memo.get('k', factory), memo.get('k', factory), memo.get('k', factory)])

      expect(calls).toBe(1)
    })

    it('should keep distinct keys separate', async () => {
      const memo = new AsyncMemo<string>()

      expect(await memo.get('a', async () => 'A')).toBe('A')
      expect(await memo.get('b', async () => 'B')).toBe('B')
      expect(memo.size).toBe(2)
    })

    it('failure case - evicts a rejected entry so it can be retried', async () => {
      const memo = new AsyncMemo<string>()

      await expect(memo.get('k', async () => {
        throw new Error('transient')
      })).rejects.toThrow('transient')

      expect(memo.size).toBe(0)
      expect(await memo.get('k', async () => 'recovered')).toBe('recovered')
    })

    it('should drop everything on clear', async () => {
      const memo = new AsyncMemo<number>()
      await memo.get('a', async () => 1)

      memo.clear()

      expect(memo.size).toBe(0)
    })
  })
})
