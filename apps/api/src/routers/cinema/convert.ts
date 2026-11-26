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
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import type {
  MediaContainerValue,
  MediaFileDetails,
  MediaFileFilterMode,
  MediaFileKindValue,
} from '#/data/cinema/media-file/types.js'

const MEDIA_FILE_KIND_TO_WIRE: Record<MediaFileKindValue, MediaFileKind> = {
  original: MediaFileKind.ORIGINAL,
}

const MEDIA_CONTAINER_TO_WIRE: Record<MediaContainerValue, MediaContainer> = {
  mp4: MediaContainer.MP4,
  mov: MediaContainer.MOV,
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
  file: MediaFileDetails,
): MessageInitShape<typeof MediaFileSchema> {
  return {
    id: file.id,
    objectId: file.objectId,
    filename: file.filename,
    sizeBytes: file.sizeBytes,
    kind: mediaFileKindToWire(file.kind),
    container: mediaContainerToWire(file.container),
    match: file.movie
      ? {
          case: 'movie',
          value: {
            movieId: file.movie.movieId,
            tmdbId: file.movie.tmdbId,
            title: file.movie.title,
            releaseYear: file.movie.releaseYear ?? 0,
          },
        }
      : file.episode
        ? {
            case: 'episode',
            value: {
              seriesId: file.episode.seriesId,
              episodeId: file.episode.episodeId,
              tmdbSeriesId: file.episode.tmdbSeriesId,
              seriesTitle: file.episode.seriesTitle,
              seasonNumber: file.episode.seasonNumber,
              episodeNumber: file.episode.episodeNumber,
              episodeTitle: file.episode.episodeTitle,
            },
          }
        : { case: undefined },
    addedAt: timestampFromDate(file.addedAt),
  }
}
