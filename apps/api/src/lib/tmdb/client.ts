import {
  normalizeMovieDetails,
  normalizeSearchResults,
  normalizeSeasonDetails,
  normalizeSeriesDetails,
} from './normalize.js'
import {
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TMDB_BASE_URL,
  TmdbError,
  type TmdbClient,
  type TmdbClientOptions,
} from './types.js'

const NUMERIC_SECONDS_RE = /^\d+(?:\.\d+)?$/

export function createTmdbClient(options: TmdbClientOptions = {}): TmdbClient {
  const apiKey = options.apiKey?.trim() || undefined
  const baseUrl = (options.baseUrl ?? DEFAULT_TMDB_BASE_URL).replace(/\/+$/, '')
  const fetchFn = options.fetch ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES)
  const initialBackoffMs = Math.max(
    0,
    options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS,
  )
  const maxBackoffMs = Math.max(
    initialBackoffMs,
    options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
  )
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  function requireApiKey(): string {
    if (!apiKey) {
      throw new TmdbError('not_configured', 'TMDB API key is not configured')
    }
    return apiKey
  }

  async function requestJson(
    path: string,
    query: Record<string, string>,
    allowNotFound: true,
  ): Promise<unknown | null>
  async function requestJson(
    path: string,
    query: Record<string, string>,
    allowNotFound: false,
  ): Promise<unknown>
  async function requestJson(
    path: string,
    query: Record<string, string>,
    allowNotFound: boolean,
  ): Promise<unknown | null> {
    const key = requireApiKey()
    const url = new URL(`${baseUrl}${path}`)
    for (const [param, value] of Object.entries(query)) {
      url.searchParams.set(param, value)
    }

    const headers: Record<string, string> = { accept: 'application/json' }
    if (isBearerToken(key)) {
      headers.authorization = `Bearer ${key}`
    } else {
      url.searchParams.set('api_key', key)
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res: Response
      try {
        res = await fetchFn(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (err) {
        throw new TmdbError('unavailable', 'TMDB request failed', {
          cause: err,
        })
      }

      if (res.status === 429) {
        await res.body?.cancel()
        if (attempt >= maxRetries) {
          throw new TmdbError('rate_limited', 'TMDB rate limit exceeded', {
            status: 429,
          })
        }
        const delayMs = retryDelayMs(
          res.headers.get('retry-after'),
          attempt,
          initialBackoffMs,
          maxBackoffMs,
          now,
        )
        await sleep(delayMs)
        continue
      }

      if (allowNotFound && res.status === 404) {
        await res.body?.cancel()
        return null
      }

      if (!res.ok) {
        await res.body?.cancel()
        throw new TmdbError(
          'unavailable',
          `TMDB request failed with status ${res.status}`,
          { status: res.status },
        )
      }

      try {
        return await res.json()
      } catch (err) {
        throw new TmdbError('unavailable', 'TMDB returned invalid JSON', {
          status: res.status,
          cause: err,
        })
      }
    }

    throw new TmdbError('rate_limited', 'TMDB rate limit exceeded', {
      status: 429,
    })
  }

  return {
    async search(query, kind) {
      requireApiKey()
      const trimmed = query.trim()
      if (!trimmed) {
        return []
      }

      const path =
        kind === 'movie'
          ? '/search/movie'
          : kind === 'series'
            ? '/search/tv'
            : '/search/multi'
      const body = await requestJson(
        path,
        { query: trimmed, include_adult: 'false' },
        false,
      )
      return normalizeSearchResults(body, kind)
    },

    async getMovie(tmdbId) {
      requireApiKey()
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
        return null
      }
      const body = await requestJson(`/movie/${tmdbId}`, {}, true)
      if (body === null) {
        return null
      }
      return normalizeMovieDetails(body)
    },

    async getSeries(tmdbId) {
      requireApiKey()
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
        return null
      }
      const body = await requestJson(`/tv/${tmdbId}`, {}, true)
      if (body === null) {
        return null
      }
      return normalizeSeriesDetails(body)
    },

    async getSeason(tmdbSeriesId, seasonNumber) {
      requireApiKey()
      if (
        !Number.isInteger(tmdbSeriesId) ||
        tmdbSeriesId <= 0 ||
        !Number.isInteger(seasonNumber) ||
        seasonNumber < 0
      ) {
        return null
      }
      const body = await requestJson(
        `/tv/${tmdbSeriesId}/season/${seasonNumber}`,
        {},
        true,
      )
      if (body === null) {
        return null
      }
      return normalizeSeasonDetails(tmdbSeriesId, seasonNumber, body)
    },
  }
}

// TMDB v4 Read Access Tokens are JWTs sent via Bearer auth; v3 API keys use the query param.
function isBearerToken(key: string): boolean {
  const parts = key.split('.')
  return parts.length === 3 && parts.every((part) => part.length > 0)
}

function retryDelayMs(
  retryAfter: string | null,
  attempt: number,
  initialBackoffMs: number,
  maxBackoffMs: number,
  now: () => number,
): number {
  if (retryAfter !== null) {
    const trimmed = retryAfter.trim()
    if (NUMERIC_SECONDS_RE.test(trimmed)) {
      const ms = Math.ceil(Number(trimmed) * 1000)
      return Math.min(Math.max(0, ms), maxBackoffMs)
    }
    const parsedDate = Date.parse(trimmed)
    if (!Number.isNaN(parsedDate)) {
      return Math.min(Math.max(0, parsedDate - now()), maxBackoffMs)
    }
  }
  return Math.min(initialBackoffMs * 2 ** attempt, maxBackoffMs)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
