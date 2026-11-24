import { RateLimiter } from '#/lib/rate-limit.js'
import { describe, expect, it } from 'vitest'

describe('RateLimiter', () => {
  it('allows up to the limit per key, then refuses until the window ends', () => {
    let now = 0
    const limiter = new RateLimiter(2, 1000, () => now)
    expect([
      limiter.allow('a'),
      limiter.allow('a'),
      limiter.allow('a'),
    ]).toEqual([true, true, false])
    expect(limiter.allow('b')).toBe(true)
    now = 999
    expect(limiter.allow('a')).toBe(false)
    now = 1000
    expect(limiter.allow('a')).toBe(true)
  })
})
