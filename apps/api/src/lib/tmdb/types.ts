export const DEFAULT_TMDB_BASE_URL = 'https://api.themoviedb.org/3'
export const DEFAULT_MAX_RETRIES = 3
export const DEFAULT_INITIAL_BACKOFF_MS = 250
export const DEFAULT_MAX_BACKOFF_MS = 5_000
export const DEFAULT_TIMEOUT_MS = 10_000

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
