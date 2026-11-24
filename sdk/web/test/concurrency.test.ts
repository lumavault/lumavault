import { forEachConcurrent } from '#/concurrency.js'
import { describe, expect, it } from 'vitest'

describe('forEachConcurrent', () => {
  it('never runs more than the limit at once and visits every item', async () => {
    let inFlight = 0
    let peak = 0
    const seen: number[] = []
    await forEachConcurrent([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 5))
      seen.push(n)
      inFlight--
    })
    expect(peak).toBe(3)
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('stops starting new work after a failure', async () => {
    const started: number[] = []
    const run = forEachConcurrent([1, 2, 3, 4], 1, async (n) => {
      started.push(n)
      if (n === 2) throw new Error('fail')
    })
    await expect(run).rejects.toThrow('fail')
    expect(started).toEqual([1, 2])
  })
})
