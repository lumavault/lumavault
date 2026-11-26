import type { z } from 'zod'

import {
  movieDetailsSchema,
  movieSearchItemSchema,
  searchEnvelopeSchema,
  seasonDetailsSchema,
  seriesDetailsSchema,
  tvSearchItemSchema,
} from './schemas.js'
import {
  TmdbError,
  type TmdbMediaKind,
  type TmdbMovieDetails,
  type TmdbSearchResult,
  type TmdbSeasonDetails,
  type TmdbSeriesDetails,
} from './types.js'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const YEAR_PREFIX_RE = /^(\d{4})/

export function normalizeSearchResults(
  body: unknown,
  kind?: TmdbMediaKind,
): TmdbSearchResult[] {
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
}

export function normalizeMovieDetails(body: unknown): TmdbMovieDetails {
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
}

export function normalizeSeriesDetails(body: unknown): TmdbSeriesDetails {
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
}

export function normalizeSeasonDetails(
  tmdbSeriesId: number,
  seasonNumber: number,
  body: unknown,
): TmdbSeasonDetails {
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
