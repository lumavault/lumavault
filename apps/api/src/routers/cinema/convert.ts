// Conversions and shared helpers between CinemaService wire types and the API's own values.
// Shared by the Cinema router files; it registers no RPCs itself.
import { create, type MessageInitShape } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  MediaContainer,
  MediaFileFilter,
  MediaFileKind,
  UnsupportedMediaFormatErrorSchema,
  type MediaFileSchema,
  type PlayableRef,
  type WatchProgressSchema,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import type {
  MediaContainerValue,
  MediaFileDetails,
  MediaFileFilterMode,
  MediaFileKindValue,
} from '#/data/cinema/media-file/types.js'
import type {
  WatchProgressRow,
  WatchProgressTarget,
} from '#/data/cinema/watch-progress/types.js'
import { parseInput, requiredUuidSchema } from '#/lib/validation.js'
import { z } from 'zod'

import { FINISH_THRESHOLD_PERCENT, PERCENT_SCALE } from './constants.js'

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
