// Conversions and shared helpers between CinemaService wire types and the API's own values.
// Shared by the Cinema router files; it registers no RPCs itself.
import { create, type MessageInitShape } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { LumaVaultClient } from '@lumavault/sdk'
import {
  CatalogErrorReason,
  CatalogErrorSchema,
  CatalogKind,
  MediaContainer,
  MediaFileFilter,
  MediaFileKind,
  UnsupportedMediaFormatErrorSchema,
  type CatalogItemSchema,
  type CatalogSearchResultSchema,
  type ContinueWatchingItemSchema,
  type EpisodeSchema,
  type GetCatalogSeasonResponseSchema,
  type GetCatalogSeriesResponseSchema,
  type MatchMediaFileRequest,
  type MediaFileSchema,
  type MovieSchema,
  type PlayableRef,
  type SeasonSchema,
  type SeriesSchema,
  type SeriesSummarySchema,
  type WatchProgressSchema,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { signReadTicket } from '#/auth/tickets.js'
import type {
  ContinueWatchingEpisodeRow,
  PlayableEpisode,
} from '#/data/cinema/episode/types.js'
import type {
  MediaContainerValue,
  MediaFileDetails,
  MediaFileFilterMode,
  MediaFileKindValue,
} from '#/data/cinema/media-file/types.js'
import type {
  ContinueWatchingMovie,
  PlayableMovie,
} from '#/data/cinema/movie/types.js'
import type { PlayableSeriesSummary } from '#/data/cinema/series/types.js'
import type {
  WatchProgressRow,
  WatchProgressTarget,
} from '#/data/cinema/watch-progress/types.js'
import type { PageCursor } from '#/data/sql.js'
import { requireApp } from '#/guards.js'
import {
  TmdbError,
  type TmdbErrorReason,
  type TmdbMediaKind,
  type TmdbSearchResult,
  type TmdbSeasonDetails,
  type TmdbSeriesDetails,
} from '#/lib/tmdb/index.js'
import {
  nonNegativeIntSchema,
  parseInput,
  positiveIntSchema,
  requiredUuidSchema,
  uuidSchema,
} from '#/lib/validation.js'
import type { ModuleContext } from '#/server/modules.js'
import { z } from 'zod'

import { FINISH_THRESHOLD_PERCENT, PERCENT_SCALE } from './constants.js'

export type ArtUrlSigner = (objectId: string | null) => string

const MEDIA_FILE_KIND_TO_WIRE: Record<MediaFileKindValue, MediaFileKind> = {
  original: MediaFileKind.ORIGINAL,
}

const MEDIA_CONTAINER_TO_WIRE: Record<MediaContainerValue, MediaContainer> = {
  mp4: MediaContainer.MP4,
  mov: MediaContainer.MOV,
}

const playableTargetSchema = z.discriminatedUnion(
  'case',
  [
    z.object({
      case: z.literal('movieId'),
      value: requiredUuidSchema('movie_id'),
    }),
    z.object({
      case: z.literal('episodeId'),
      value: requiredUuidSchema('episode_id'),
    }),
  ],
  { error: 'target movie_id or episode_id is required' },
)

/** Signs an active art object ID into a short-lived Gateway stream URL, or returns empty. */
export function createArtUrlSigner(
  ctx: Pick<ModuleContext, 'config'>,
): ArtUrlSigner {
  const sdk = new LumaVaultClient({ baseUrl: ctx.config.gatewayUrl })
  return (objectId) => {
    if (!objectId) {
      return ''
    }
    const { ticket } = signReadTicket(ctx.config.ticketSecret, { objectId })
    return sdk.streamUrl(objectId, ticket)
  }
}

/** Verifies the caller is signed in with Cinema access (or is a Super-Admin). */
export function requireCinemaAccess(
  call: Parameters<typeof requireApp>[0],
  ctx: ModuleContext,
) {
  return requireApp(call, ctx, 'cinema', {
    allowSuperAdminWithoutHousehold: true,
  })
}

/** Validates that a decoded page cursor carries a UUID ID. */
export function assertUuidCursor(after: PageCursor | undefined): void {
  if (after) {
    parseInput(uuidSchema, after.id, 'page_token is not valid')
  }
}

export function mediaFileKindToWire(kind: MediaFileKindValue): MediaFileKind {
  return MEDIA_FILE_KIND_TO_WIRE[kind]
}

export function mediaContainerToWire(
  container: MediaContainerValue,
): MediaContainer {
  return MEDIA_CONTAINER_TO_WIRE[container]
}

/** The list filter named by a request, defaulting UNSPECIFIED to all files. */
export function mediaFileFilterFromWire(
  filter: MediaFileFilter,
): MediaFileFilterMode {
  switch (filter) {
    case MediaFileFilter.UNSPECIFIED:
    case MediaFileFilter.ALL:
      return 'all'
    case MediaFileFilter.UNMATCHED:
      return 'unmatched'
    case MediaFileFilter.MATCHED:
      return 'matched'
    default:
      throw new ConnectError('filter is not valid', Code.InvalidArgument)
  }
}

/** InvalidArgument error carrying UnsupportedMediaFormatError details for rejected uploads. */
export function unsupportedMediaFormatError(
  detectedFormat: string,
): ConnectError {
  return new ConnectError(
    'unsupported media format; only MP4 and MOV are supported',
    Code.InvalidArgument,
    undefined,
    [
      {
        desc: UnsupportedMediaFormatErrorSchema,
        value: create(UnsupportedMediaFormatErrorSchema, {
          detectedFormat,
          supportedContainers: [MediaContainer.MP4, MediaContainer.MOV],
        }),
      },
    ],
  )
}

/** A library media file with its size and optional movie or episode match as a wire MediaFile. */
export function mediaFileToWire(
  details: MediaFileDetails,
): MessageInitShape<typeof MediaFileSchema> {
  const { file, sizeBytes, movie, episode, series } = details
  return {
    id: file.id,
    objectId: file.objectId,
    filename: file.filename,
    sizeBytes,
    kind: mediaFileKindToWire(file.kind),
    container: mediaContainerToWire(file.container),
    match: movie
      ? {
          case: 'movie',
          value: {
            movieId: movie.id,
            tmdbId: movie.tmdbId,
            title: movie.title,
            releaseYear: movie.releaseYear ?? 0,
          },
        }
      : episode && series
        ? {
            case: 'episode',
            value: {
              seriesId: episode.seriesId,
              episodeId: episode.id,
              tmdbSeriesId: series.tmdbId,
              seriesTitle: series.title,
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.episodeNumber,
              episodeTitle: episode.title,
            },
          }
        : { case: undefined },
    addedAt: timestampFromDate(file.addedAt),
  }
}

/** Validates a PlayableRef from a request and converts it into a WatchProgressTarget. */
export function playableRefFromWire(
  ref: PlayableRef | undefined,
): WatchProgressTarget {
  const target = parseInput(playableTargetSchema, ref?.target)
  return target.case === 'movieId'
    ? { kind: 'movie', id: target.value }
    : { kind: 'episode', id: target.value }
}

/** True when playback has reached the completion threshold for a known duration. */
export function hasReachedFinish(
  positionMs: bigint,
  durationMs: bigint,
): boolean {
  return (
    durationMs > 0n &&
    positionMs * PERCENT_SCALE >= durationMs * FINISH_THRESHOLD_PERCENT
  )
}

/** NotFound error naming the missing movie or episode. */
export function targetNotFoundError(target: WatchProgressTarget): ConnectError {
  return new ConnectError(
    target.kind === 'movie' ? 'movie not found' : 'episode not found',
    Code.NotFound,
  )
}

/** A watch progress row as a CinemaService WatchProgress message. */
export function progressToWire(
  row: WatchProgressRow,
): MessageInitShape<typeof WatchProgressSchema> {
  return {
    positionMs: row.positionMs,
    durationMs: row.durationMs,
    finished: row.finished,
    watchCount: row.watchCount,
    updatedAt: timestampFromDate(row.updatedAt),
  }
}

/** A playable movie row as a CinemaService Movie message. */
export function movieToWire(
  movie: PlayableMovie,
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof MovieSchema> {
  return {
    id: movie.id,
    tmdbId: movie.tmdbId,
    title: movie.title,
    overview: movie.overview,
    releaseYear: movie.releaseYear ?? 0,
    runtimeMinutes: movie.runtimeMinutes ?? 0,
    posterUrl: artUrl(movie.posterObjectId),
    backdropUrl: artUrl(movie.backdropObjectId),
    progress: movie.progress ? progressToWire(movie.progress) : undefined,
    addedAt: timestampFromDate(movie.addedAt),
  }
}

function seriesBaseFields(series: PlayableSeriesSummary, artUrl: ArtUrlSigner) {
  return {
    id: series.id,
    tmdbId: series.tmdbId,
    title: series.title,
    overview: series.overview,
    firstAirYear: series.firstAirYear ?? 0,
    posterUrl: artUrl(series.posterObjectId),
    backdropUrl: artUrl(series.backdropObjectId),
    watchedEpisodeCount: series.watchedEpisodeCount,
    totalEpisodeCount: series.totalEpisodeCount,
    addedAt: timestampFromDate(series.addedAt),
  }
}

/** A playable series summary as a CinemaService SeriesSummary message. */
export function seriesSummaryToWire(
  series: PlayableSeriesSummary,
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof SeriesSummarySchema> {
  return seriesBaseFields(series, artUrl)
}

/** A playable episode row as a CinemaService Episode message. */
export function episodeToWire(
  episode: PlayableEpisode,
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof EpisodeSchema> {
  return {
    id: episode.id,
    tmdbId: episode.tmdbId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    overview: episode.overview,
    runtimeMinutes: episode.runtimeMinutes ?? 0,
    stillUrl: artUrl(episode.stillObjectId),
    airDate: episode.airDate ?? '',
    progress: episode.progress ? progressToWire(episode.progress) : undefined,
    addedAt: timestampFromDate(episode.addedAt),
  }
}

function groupSeasons(
  episodes: PlayableEpisode[],
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof SeasonSchema>[] {
  const seasons: {
    seasonNumber: number
    episodes: MessageInitShape<typeof EpisodeSchema>[]
  }[] = []
  for (const ep of episodes) {
    const last = seasons[seasons.length - 1]
    if (last && last.seasonNumber === ep.seasonNumber) {
      last.episodes.push(episodeToWire(ep, artUrl))
    } else {
      seasons.push({
        seasonNumber: ep.seasonNumber,
        episodes: [episodeToWire(ep, artUrl)],
      })
    }
  }
  return seasons
}

/** A playable series with its episodes grouped into ascending seasons. */
export function seriesToWire(
  series: PlayableSeriesSummary,
  episodes: PlayableEpisode[],
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof SeriesSchema> {
  return {
    ...seriesBaseFields(series, artUrl),
    seasons: groupSeasons(episodes, artUrl),
  }
}

/** A movie or series summary wrapped as a CinemaService CatalogItem. */
export function catalogItemToWire(
  entry:
    | { kind: 'movie'; movie: PlayableMovie }
    | { kind: 'series'; series: PlayableSeriesSummary },
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof CatalogItemSchema> {
  if (entry.kind === 'movie') {
    return {
      item: { case: 'movie', value: movieToWire(entry.movie, artUrl) },
    }
  }
  return {
    item: { case: 'series', value: seriesSummaryToWire(entry.series, artUrl) },
  }
}

/** An in-progress movie or episode entry wrapped as a CinemaService ContinueWatchingItem. */
export function continueWatchingItemToWire(
  entry:
    | { kind: 'movie'; item: ContinueWatchingMovie }
    | { kind: 'episode'; item: ContinueWatchingEpisodeRow },
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof ContinueWatchingItemSchema> {
  if (entry.kind === 'movie') {
    return {
      item: { case: 'movie', value: movieToWire(entry.item.movie, artUrl) },
      progress: progressToWire(entry.item.progress),
    }
  }
  return {
    item: {
      case: 'episode',
      value: {
        seriesId: entry.item.seriesId,
        seriesTitle: entry.item.seriesTitle,
        seriesPosterUrl: artUrl(entry.item.seriesPosterObjectId),
        seriesBackdropUrl: artUrl(entry.item.seriesBackdropObjectId),
        episode: episodeToWire(entry.item.episode, artUrl),
      },
    },
    progress: entry.item.progress
      ? progressToWire(entry.item.progress)
      : undefined,
  }
}

/** Validated catalog match target parsed from a MatchMediaFileRequest. */
export type CatalogMatchTarget =
  | { kind: 'movie'; tmdbMovieId: number }
  | {
      kind: 'episode'
      tmdbSeriesId: number
      seasonNumber: number
      episodeNumber: number
    }

const matchTargetSchema = z.discriminatedUnion(
  'case',
  [
    z.object({
      case: z.literal('tmdbMovieId'),
      value: positiveIntSchema('tmdb_movie_id'),
    }),
    z.object({
      case: z.literal('episode'),
      value: z.object({
        tmdbSeriesId: positiveIntSchema('tmdb_series_id'),
        seasonNumber: nonNegativeIntSchema('season_number'),
        episodeNumber: positiveIntSchema('episode_number'),
      }),
    }),
  ],
  { error: 'target tmdb_movie_id or episode is required' },
)

const CATALOG_KIND_TO_WIRE: Record<TmdbMediaKind, CatalogKind> = {
  movie: CatalogKind.MOVIE,
  series: CatalogKind.SERIES,
}

const CATALOG_ERROR_MAP: Record<
  TmdbErrorReason,
  { code: Code; reason: CatalogErrorReason; message: string }
> = {
  not_configured: {
    code: Code.FailedPrecondition,
    reason: CatalogErrorReason.NOT_CONFIGURED,
    message: 'metadata catalog is not configured',
  },
  rate_limited: {
    code: Code.ResourceExhausted,
    reason: CatalogErrorReason.RATE_LIMITED,
    message: 'metadata catalog rate limit exceeded',
  },
  unavailable: {
    code: Code.Unavailable,
    reason: CatalogErrorReason.UNAVAILABLE,
    message: 'metadata catalog is unavailable',
  },
}

/** Converts a wire CatalogKind filter to a TMDB kind, or undefined to search both. */
export function catalogKindFromWire(
  kind: CatalogKind,
): TmdbMediaKind | undefined {
  switch (kind) {
    case CatalogKind.UNSPECIFIED:
      return undefined
    case CatalogKind.MOVIE:
      return 'movie'
    case CatalogKind.SERIES:
      return 'series'
    default:
      throw new ConnectError('kind is not valid', Code.InvalidArgument)
  }
}

export function catalogKindToWire(kind: TmdbMediaKind): CatalogKind {
  return CATALOG_KIND_TO_WIRE[kind]
}

/** A TMDB search hit as a metadata-only CatalogSearchResult wire message. */
export function catalogSearchResultToWire(
  result: TmdbSearchResult,
): MessageInitShape<typeof CatalogSearchResultSchema> {
  return {
    tmdbId: result.tmdbId,
    kind: catalogKindToWire(result.kind),
    title: result.title,
    overview: result.overview,
    releaseYear: result.releaseYear ?? 0,
  }
}

/** TMDB series metadata and season summaries as a GetCatalogSeriesResponse wire message. */
export function catalogSeriesToWire(
  series: TmdbSeriesDetails,
): MessageInitShape<typeof GetCatalogSeriesResponseSchema> {
  const seasons = [...series.seasons]
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .map((season) => ({
      seasonNumber: season.seasonNumber,
      name: season.name,
      episodeCount: season.episodeCount,
      airDate: season.airDate ?? '',
    }))
  return {
    tmdbSeriesId: series.tmdbId,
    title: series.title,
    firstAirYear: series.firstAirYear ?? 0,
    seasons,
  }
}

/** TMDB season episode summaries as a GetCatalogSeasonResponse wire message. */
export function catalogSeasonToWire(
  season: TmdbSeasonDetails,
): MessageInitShape<typeof GetCatalogSeasonResponseSchema> {
  const episodes = [...season.episodes]
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((ep) => ({
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      overview: ep.overview,
      airDate: ep.airDate ?? '',
    }))
  return {
    tmdbSeriesId: season.tmdbSeriesId,
    seasonNumber: season.seasonNumber,
    episodes,
  }
}

/** Validates a MatchMediaFileRequest target oneof into a typed movie or episode target. */
export function matchTargetFromWire(
  target: MatchMediaFileRequest['target'],
): CatalogMatchTarget {
  const parsed = parseInput(matchTargetSchema, target)
  if (parsed.case === 'tmdbMovieId') {
    return { kind: 'movie', tmdbMovieId: parsed.value }
  }
  return {
    kind: 'episode',
    tmdbSeriesId: parsed.value.tmdbSeriesId,
    seasonNumber: parsed.value.seasonNumber,
    episodeNumber: parsed.value.episodeNumber,
  }
}

/** ConnectError carrying a typed CatalogError detail for TMDB lookup failures. */
export function catalogErrorFromTmdb(err: TmdbError): ConnectError {
  const mapped = CATALOG_ERROR_MAP[err.reason]
  return new ConnectError(mapped.message, mapped.code, undefined, [
    {
      desc: CatalogErrorSchema,
      value: create(CatalogErrorSchema, { reason: mapped.reason }),
    },
  ])
}

/** Runs a TMDB call and converts any TmdbError into a ConnectError with CatalogError details. */
export async function withCatalogErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof TmdbError) {
      throw catalogErrorFromTmdb(err)
    }
    throw err
  }
}
