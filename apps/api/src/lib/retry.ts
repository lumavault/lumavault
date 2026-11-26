import {
  DEFAULT_HTTP_INITIAL_BACKOFF_MS,
  DEFAULT_HTTP_MAX_BACKOFF_MS,
  DEFAULT_HTTP_MAX_RETRIES,
} from './constants.js'

const NUMERIC_SECONDS_RE = /^\d+(?:\.\d+)?$/
const NEGATIVE_NUMBER_RE = /^-\d+(?:\.\d+)?$/

export interface RetryHttpOptions {
  maxRetries?: number
  initialBackoffMs?: number
  maxBackoffMs?: number
  /** Returns true when an HTTP response should be retried. Defaults to status 429. */
  shouldRetryResponse?: (response: Response) => boolean
  /** Returns true when a thrown request error should be retried. Defaults to false. */
  shouldRetryError?: (error: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/**
 * Parses an HTTP Retry-After header (delay-seconds or HTTP-date) into milliseconds.
 * Past dates clamp to 0; missing or malformed values return null.
 */
export function parseRetryAfterMs(
  header: string | null,
  nowMs: number = Date.now(),
): number | null {
  if (header === null) {
    return null
  }
  const trimmed = header.trim()
  if (!trimmed || NEGATIVE_NUMBER_RE.test(trimmed)) {
    return null
  }
  if (NUMERIC_SECONDS_RE.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null
  }
  const parsedDate = Date.parse(trimmed)
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - nowMs)
  }
  return null
}

/**
 * Runs an HTTP request with exponential backoff and Retry-After delay handling.
 * Cancels retried response bodies before sleeping and returns the final response
 * once retries are exhausted.
 */
export async function retryHttp(
  request: (attempt: number) => Promise<Response>,
  options: RetryHttpOptions = {},
): Promise<Response> {
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_HTTP_MAX_RETRIES)
  const initialBackoffMs = Math.max(
    0,
    options.initialBackoffMs ?? DEFAULT_HTTP_INITIAL_BACKOFF_MS,
  )
  const maxBackoffMs = Math.max(
    initialBackoffMs,
    options.maxBackoffMs ?? DEFAULT_HTTP_MAX_BACKOFF_MS,
  )
  const shouldRetryResponse = options.shouldRetryResponse ?? isRateLimited
  const shouldRetryError = options.shouldRetryError ?? neverRetryError
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await request(attempt)
    } catch (err) {
      if (attempt >= maxRetries || !shouldRetryError(err)) {
        throw err
      }
      await sleep(exponentialBackoffMs(attempt, initialBackoffMs, maxBackoffMs))
      continue
    }

    if (attempt >= maxRetries || !shouldRetryResponse(res)) {
      return res
    }

    const retryAfterMs = parseRetryAfterMs(
      res.headers.get('retry-after'),
      now(),
    )
    const delayMs =
      retryAfterMs !== null
        ? Math.min(retryAfterMs, maxBackoffMs)
        : exponentialBackoffMs(attempt, initialBackoffMs, maxBackoffMs)

    await res.body?.cancel()
    await sleep(delayMs)
  }
}

function exponentialBackoffMs(
  attempt: number,
  initialBackoffMs: number,
  maxBackoffMs: number,
): number {
  return Math.min(initialBackoffMs * 2 ** attempt, maxBackoffMs)
}

function isRateLimited(response: Response): boolean {
  return response.status === 429
}

function neverRetryError(): boolean {
  return false
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
