import { z } from 'zod'

export const DEFAULT_TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_INITIAL_BACKOFF_MS = 250
const DEFAULT_MAX_BACKOFF_MS = 5_000
const DEFAULT_TIMEOUT_MS = 10_000

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const YEAR_PREFIX_RE = /^(\d{4})/
const NUMERIC_SECONDS_RE = /^\d+(?:\.\d+)?$/

export type TmdbMediaKind = 'movie' | 'series'

export type TmdbErrorReason = 'not_configured' | 'rate_limited' | 'unavailable'

/** Typed failure returned by TMDB lookups so callers can map directly to CatalogErrorReason. */
export class TmdbError extends Error {
  readonly reason: TmdbErrorReason
  readonly status?: number

  constructor(
    reason: TmdbErrorReason,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, { cause: options?.cause })
    this.name = 'TmdbError'
    this.reason = reason
    this.status = options?.status
  }
}

export interface TmdbSearchResult {
  tmdbId: number
  kind: TmdbMediaKind
  title: string
  overview: string
  /** Release year for movies, or first air year for series. Null when unknown. */
  releaseYear: number | null
}

export interface TmdbMovieDetails {
  tmdbId: number
  title: string
  overview: string
  releaseYear: number | null
  runtimeMinutes: number | null
  posterPath: string | null
  backdropPath: string | null
}

export interface TmdbSeasonSummary {
  seasonNumber: number
  name: string
  episodeCount: number
  /** ISO-8601 date (YYYY-MM-DD), or null when unknown. */
  airDate: string | null
}

export interface TmdbSeriesDetails {
  tmdbId: number
  title: string
  overview: string
  firstAirYear: number | null
  posterPath: string | null
  backdropPath: string | null
  seasons: TmdbSeasonSummary[]
}

export interface TmdbEpisodeDetails {
  tmdbId: number
  episodeNumber: number
  title: string
  overview: string
  /** ISO-8601 date (YYYY-MM-DD), or null when unknown. */
  airDate: string | null
  runtimeMinutes: number | null
  stillPath: string | null
}

export interface TmdbSeasonDetails {
  tmdbSeriesId: number
  seasonNumber: number
  episodes: TmdbEpisodeDetails[]
}

/** Server-side client for TMDB metadata lookups. Keeps API credentials off clients. */
export interface TmdbClient {
  /** Searches TMDB for movies, TV series, or both when kind is omitted. */
  search(query: string, kind?: TmdbMediaKind): Promise<TmdbSearchResult[]>
  /** Fetches details for one movie, or null when TMDB reports 404. */
  getMovie(tmdbId: number): Promise<TmdbMovieDetails | null>
  /** Fetches details and season summaries for one TV series, or null when TMDB reports 404. */
  getSeries(tmdbId: number): Promise<TmdbSeriesDetails | null>
  /** Fetches episodes for one season of a TV series, or null when TMDB reports 404. */
  getSeason(
    tmdbSeriesId: number,
    seasonNumber: number,
  ): Promise<TmdbSeasonDetails | null>
}

export interface TmdbClientOptions {
  apiKey?: string
  baseUrl?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  maxRetries?: number
  initialBackoffMs?: number
  maxBackoffMs?: number
  timeoutMs?: number
}

const searchEnvelopeSchema = z.object({
  results: z.array(z.unknown()).default([]),
})

const movieSearchItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  overview: z.string().nullish(),
  release_date: z.string().nullish(),
})

const tvSearchItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  overview: z.string().nullish(),
  first_air_date: z.string().nullish(),
})

const movieDetailsSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  overview: z.string().nullish(),
  release_date: z.string().nullish(),
  runtime: z.number().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
})

const seasonSummarySchema = z.object({
  season_number: z.number().int().nonnegative(),
  name: z.string().nullish(),
  episode_count: z.number().int().nonnegative().default(0),
  air_date: z.string().nullish(),
})

const seriesDetailsSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  overview: z.string().nullish(),
  first_air_date: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  seasons: z.array(seasonSummarySchema).default([]),
})

const episodeDetailsSchema = z.object({
  id: z.number().int().positive(),
  episode_number: z.number().int().positive(),
  name: z.string().nullish(),
  overview: z.string().nullish(),
  air_date: z.string().nullish(),
  runtime: z.number().nullish(),
  still_path: z.string().nullish(),
})

const seasonDetailsSchema = z.object({
  season_number: z.number().int().nonnegative().optional(),
  episodes: z.array(episodeDetailsSchema).default([]),
})

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
      const parsed = parseOrUnavailable(searchEnvelopeSchema, body)

      if (kind === 'movie') {
        return parsed.results.map((raw) =>
          toMovieSearchResult(parseOrUnavailable(movieSearchItemSchema, raw)),
        )
      }
      if (kind === 'series') {
        return parsed.results.map((raw) =>
          toSeriesSearchResult(parseOrUnavailable(tvSearchItemSchema, raw)),
        )
      }

      const results: TmdbSearchResult[] = []
      for (const raw of parsed.results) {
        if (typeof raw !== 'object' || raw === null) {
          continue
        }
        const mediaType = (raw as { media_type?: unknown }).media_type
        if (mediaType === 'movie') {
          results.push(
            toMovieSearchResult(parseOrUnavailable(movieSearchItemSchema, raw)),
          )
        } else if (mediaType === 'tv') {
          results.push(
            toSeriesSearchResult(parseOrUnavailable(tvSearchItemSchema, raw)),
          )
        }
      }
      return results
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
      const movie = parseOrUnavailable(movieDetailsSchema, body)
      return {
        tmdbId: movie.id,
        title: movie.title,
        overview: movie.overview ?? '',
        releaseYear: parseYear(movie.release_date),
        runtimeMinutes: parsePositiveMinutes(movie.runtime),
        posterPath: parseRelativePath(movie.poster_path),
        backdropPath: parseRelativePath(movie.backdrop_path),
      }
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
      const series = parseOrUnavailable(seriesDetailsSchema, body)
      return {
        tmdbId: series.id,
        title: series.name,
        overview: series.overview ?? '',
        firstAirYear: parseYear(series.first_air_date),
        posterPath: parseRelativePath(series.poster_path),
        backdropPath: parseRelativePath(series.backdrop_path),
        seasons: series.seasons.map((season) => ({
          seasonNumber: season.season_number,
          name: season.name ?? '',
          episodeCount: season.episode_count,
          airDate: parseIsoDate(season.air_date),
        })),
      }
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
      const season = parseOrUnavailable(seasonDetailsSchema, body)
      return {
        tmdbSeriesId,
        seasonNumber: season.season_number ?? seasonNumber,
        episodes: season.episodes.map((ep) => ({
          tmdbId: ep.id,
          episodeNumber: ep.episode_number,
          title: ep.name ?? '',
          overview: ep.overview ?? '',
          airDate: parseIsoDate(ep.air_date),
          runtimeMinutes: parsePositiveMinutes(ep.runtime),
          stillPath: parseRelativePath(ep.still_path),
        })),
      }
    },
  }
}

function toMovieSearchResult(
  item: z.infer<typeof movieSearchItemSchema>,
): TmdbSearchResult {
  return {
    tmdbId: item.id,
    kind: 'movie',
    title: item.title,
    overview: item.overview ?? '',
    releaseYear: parseYear(item.release_date),
  }
}

function toSeriesSearchResult(
  item: z.infer<typeof tvSearchItemSchema>,
): TmdbSearchResult {
  return {
    tmdbId: item.id,
    kind: 'series',
    title: item.name,
    overview: item.overview ?? '',
    releaseYear: parseYear(item.first_air_date),
  }
}

function parseOrUnavailable<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new TmdbError('unavailable', 'TMDB returned an unexpected payload', {
      cause: parsed.error,
    })
  }
  return parsed.data
}

function parseYear(date: string | null | undefined): number | null {
  if (!date) {
    return null
  }
  const match = YEAR_PREFIX_RE.exec(date.trim())
  if (!match?.[1]) {
    return null
  }
  const year = Number(match[1])
  return Number.isInteger(year) && year > 0 ? year : null
}

function parseIsoDate(date: string | null | undefined): string | null {
  if (!date) {
    return null
  }
  const trimmed = date.trim()
  return ISO_DATE_RE.test(trimmed) ? trimmed : null
}

function parsePositiveMinutes(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.round(value)
}

function parseRelativePath(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null
  }
  return trimmed
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
