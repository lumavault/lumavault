import { parseRetryAfterMs, retryHttp } from '#/lib/retry.js'
import { describe, expect, it } from 'vitest'

describe('parseRetryAfterMs', () => {
  const fixedNow = Date.UTC(2026, 10, 26, 12, 0, 0)

  it('parses numeric delay-seconds headers', () => {
    expect(parseRetryAfterMs('0', fixedNow)).toBe(0)
    expect(parseRetryAfterMs('2', fixedNow)).toBe(2000)
    expect(parseRetryAfterMs(' 1.25 ', fixedNow)).toBe(1250)
    expect(parseRetryAfterMs('0.0001', fixedNow)).toBe(1)
  })

  it('parses HTTP-date headers and clamps past dates to zero', () => {
    const future = new Date(fixedNow + 3000).toUTCString()
    const past = new Date(fixedNow - 5000).toUTCString()
    const exact = new Date(fixedNow).toUTCString()

    expect(parseRetryAfterMs(future, fixedNow)).toBe(3000)
    expect(parseRetryAfterMs(future, fixedNow + 500)).toBe(2500)
    expect(parseRetryAfterMs(past, fixedNow)).toBe(0)
    expect(parseRetryAfterMs(exact, fixedNow)).toBe(0)
  })

  it('returns null for missing, empty, negative, or malformed headers', () => {
    expect(parseRetryAfterMs(null, fixedNow)).toBeNull()
    expect(parseRetryAfterMs('', fixedNow)).toBeNull()
    expect(parseRetryAfterMs('   ', fixedNow)).toBeNull()
    expect(parseRetryAfterMs('-5', fixedNow)).toBeNull()
    expect(parseRetryAfterMs('not-a-date', fixedNow)).toBeNull()
  })
})

describe('retryHttp', () => {
  it('returns immediately on a non-retried response without sleeping', async () => {
    const seenAttempts: number[] = []
    const res = await retryHttp(
      async (attempt) => {
        seenAttempts.push(attempt)
        return new Response('ok', { status: 200 })
      },
      {
        sleep: async () => {
          expect.unreachable('should not sleep on success')
        },
      },
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(seenAttempts).toEqual([0])
  })

  it('backs off exponentially on HTTP 429 and caps at maxBackoffMs', async () => {
    const delays: number[] = []
    const seenAttempts: number[] = []
    const res = await retryHttp(
      async (attempt) => {
        seenAttempts.push(attempt)
        if (attempt < 3) {
          return new Response('slow down', { status: 429 })
        }
        return new Response('done', { status: 200 })
      },
      {
        maxRetries: 3,
        initialBackoffMs: 100,
        maxBackoffMs: 250,
        sleep: async (ms) => {
          delays.push(ms)
        },
      },
    )

    expect(res.status).toBe(200)
    expect(seenAttempts).toEqual([0, 1, 2, 3])
    expect(delays).toEqual([100, 200, 250])
  })

  it('uses numeric and HTTP-date Retry-After headers clamped to maxBackoffMs', async () => {
    const fixedNow = Date.UTC(2026, 10, 26, 12, 0, 0)
    const delays: number[] = []
    const headersByAttempt = [
      '1',
      '60',
      new Date(fixedNow + 2000).toUTCString(),
      'malformed',
    ]

    const res = await retryHttp(
      async (attempt) => {
        const retryAfter = headersByAttempt[attempt]
        if (retryAfter !== undefined) {
          return new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': retryAfter },
          })
        }
        return new Response('ok', { status: 200 })
      },
      {
        maxRetries: 4,
        initialBackoffMs: 100,
        maxBackoffMs: 2500,
        now: () => fixedNow,
        sleep: async (ms) => {
          delays.push(ms)
        },
      },
    )

    expect(res.status).toBe(200)
    expect(delays).toEqual([1000, 2500, 2000, 800])
  })

  it('returns the final response without sleeping once retries are exhausted', async () => {
    const delays: number[] = []
    let calls = 0
    const res = await retryHttp(
      async () => {
        calls += 1
        return new Response(`attempt-${calls}`, { status: 429 })
      },
      {
        maxRetries: 2,
        initialBackoffMs: 50,
        sleep: async (ms) => {
          delays.push(ms)
        },
      },
    )

    expect(res.status).toBe(429)
    expect(await res.text()).toBe('attempt-3')
    expect(calls).toBe(3)
    expect(delays).toEqual([50, 100])
  })

  it('makes a single attempt without sleeping when maxRetries is zero', async () => {
    let calls = 0
    const res = await retryHttp(
      async () => {
        calls += 1
        return new Response('limited', { status: 429 })
      },
      {
        maxRetries: 0,
        sleep: async () => {
          expect.unreachable('should not sleep when maxRetries is 0')
        },
      },
    )

    expect(res.status).toBe(429)
    expect(calls).toBe(1)
  })

  it('cancels retried response bodies before sleeping', async () => {
    let canceled = 0
    const makeStreamResponse = (status: number) =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled += 1
          },
        }),
        { status },
      )

    const res = await retryHttp(
      async (attempt) =>
        attempt === 0 ? makeStreamResponse(429) : makeStreamResponse(200),
      {
        maxRetries: 1,
        initialBackoffMs: 10,
        sleep: async () => {
          expect(canceled).toBe(1)
        },
      },
    )

    expect(res.status).toBe(200)
    expect(canceled).toBe(1)
    await res.body?.cancel()
  })

  it('does not retry non-429 responses or thrown errors by default', async () => {
    const res = await retryHttp(
      async () => new Response('unavailable', { status: 503 }),
      {
        sleep: async () => {
          expect.unreachable('should not retry 503 by default')
        },
      },
    )
    expect(res.status).toBe(503)

    const boom = new TypeError('network down')
    await expect(
      retryHttp(
        async () => {
          throw boom
        },
        {
          sleep: async () => {
            expect.unreachable('should not retry errors by default')
          },
        },
      ),
    ).rejects.toBe(boom)
  })

  it('supports custom shouldRetryResponse and shouldRetryError predicates', async () => {
    const delays: number[] = []
    const res = await retryHttp(
      async (attempt) => {
        if (attempt === 0) {
          throw new TypeError('transient socket reset')
        }
        if (attempt === 1) {
          return new Response('busy', { status: 503 })
        }
        return new Response('ok', { status: 200 })
      },
      {
        maxRetries: 3,
        initialBackoffMs: 50,
        shouldRetryResponse: (r) => r.status === 429 || r.status === 503,
        shouldRetryError: (err) => err instanceof TypeError,
        sleep: async (ms) => {
          delays.push(ms)
        },
      },
    )

    expect(res.status).toBe(200)
    expect(delays).toEqual([50, 100])
  })

  it('rethrows a retryable error once retries are exhausted', async () => {
    const delays: number[] = []
    const boom = new TypeError('still down')
    let calls = 0

    await expect(
      retryHttp(
        async () => {
          calls += 1
          throw boom
        },
        {
          maxRetries: 2,
          initialBackoffMs: 25,
          shouldRetryError: () => true,
          sleep: async (ms) => {
            delays.push(ms)
          },
        },
      ),
    ).rejects.toBe(boom)

    expect(calls).toBe(3)
    expect(delays).toEqual([25, 50])
  })
})
