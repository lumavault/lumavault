/** Runs worker over items with at most limit calls in flight, stopping at the first failure. */
export async function forEachConcurrent<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  let failed = false
  const lane = async () => {
    while (!failed && next < items.length) {
      const item = items[next++] as T
      try {
        await worker(item)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane),
  )
}
