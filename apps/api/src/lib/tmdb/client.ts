import { retryHttp } from '#/lib/retry.js'
import { isBearerToken } from '#/lib/secrets.js'

import {
  normalizeMovieDetails,
  normalizeSearchResults,
  normalizeSeasonDetails,
  normalizeSeriesDetails,
} from './normalize.js'
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TMDB_BASE_URL,
  TmdbError,
  type TmdbClient,
  type TmdbClientOptions,
} from './types.js'

export function createTmdbClient(options: TmdbClientOptions = {}): TmdbClient {
  const apiKey = options.apiKey?.trim() || undefined
  const baseUrl = (options.baseUrl ?? DEFAULT_TMDB_BASE_URL).replace(/\/+$/, '')
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryOptions = {
    maxRetries: options.maxRetries,
    initialBackoffMs: options.initialBackoffMs,
    maxBackoffMs: options.maxBackoffMs,
    sleep: options.sleep,
    now: options.now,
  }

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
    // TMDB v4 Read Access Tokens are JWTs sent via Bearer auth; v3 API keys use the query param.
    if (isBearerToken(key)) {
      headers.authorization = `Bearer ${key}`
    } else {
      url.searchParams.set('api_key', key)
    }

    let res: Response
    try {
      res = await retryHttp(
        () =>
          fetchFn(url, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          }),
        retryOptions,
      )
    } catch (err) {
      throw new TmdbError('unavailable', 'TMDB request failed', {
        cause: err,
      })
    }

    if (res.status === 429) {
      await res.body?.cancel()
      throw new TmdbError('rate_limited', 'TMDB rate limit exceeded', {
        status: 429,
      })
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
