/**
 * Default in-flight request cap.
 *
 * Registry APIs tolerate parallel reads well, but an unbounded fan-out over a
 * few hundred dependencies gets buddy-bot secondary-rate-limited. Eight keeps
 * scans fast without tripping npm or GitHub throttling.
 */
export const DEFAULT_CONCURRENCY = 8

/**
 * Map over items with a bounded number of concurrent workers, preserving
 * input order in the result.
 *
 * A rejected task rejects the whole call, matching `Promise.all`. Callers that
 * want partial results should resolve to a sentinel inside `worker` rather
 * than throwing.
 *
 * @param items - Values to process
 * @param worker - Async transform, receiving the item and its original index
 * @param concurrency - Maximum tasks in flight (default: {@link DEFAULT_CONCURRENCY})
 * @returns Results in the same order as `items`
 * @example
 * ```ts
 * const versions = await mapWithConcurrency(
 *   packageNames,
 *   name => registry.getLatestVersion(name),
 *   16,
 * )
 * ```
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  if (items.length === 0)
    return []

  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = Array.from({ length: items.length }) as R[]
  let cursor = 0

  async function runWorker(): Promise<void> {
    while (true) {
      const index = cursor++
      if (index >= items.length)
        return
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: limit }, runWorker))
  return results
}

/**
 * Split an array into fixed-size chunks.
 *
 * @param items - Values to split
 * @param size - Maximum chunk length; values below 1 are clamped to 1
 * @returns Array of chunks, the last possibly shorter than `size`
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, size)
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += step)
    chunks.push(items.slice(i, i + step))
  return chunks
}

/**
 * Deduplicate concurrent async calls that share a key.
 *
 * Two callers asking for the same package's metadata at the same time should
 * produce one network request, not two. Failed lookups are evicted so a
 * transient error is not cached for the lifetime of the run.
 */
export class AsyncMemo<T> {
  private readonly entries = new Map<string, Promise<T>>()

  /**
   * Return the memoized value for `key`, invoking `factory` on first request.
   *
   * @param key - Cache key
   * @param factory - Producer invoked only on a miss
   */
  async get(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key)
    if (existing)
      return existing

    const pending = factory().catch((error: unknown) => {
      this.entries.delete(key)
      throw error
    })

    this.entries.set(key, pending)
    return pending
  }

  /** Drop all memoized values. */
  clear(): void {
    this.entries.clear()
  }

  /** Number of memoized keys, including in-flight ones. */
  get size(): number {
    return this.entries.size
  }
}
