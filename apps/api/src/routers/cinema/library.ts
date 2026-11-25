import { create, type MessageInitShape } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  CinemaService,
  MediaContainer,
  MediaFileFilter,
  MediaFileKind,
  UnsupportedMediaFormatErrorSchema,
  type MediaFileSchema,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { createMediaFile } from '#/data/cinema/media-file/create-media-file.js'
import {
  getMediaFileByObjectId,
  getMediaFilePage,
} from '#/data/cinema/media-file/get-media-file.js'
import type {
  MediaContainerValue,
  MediaFileDetails,
  MediaFileFilterMode,
  MediaFileKindValue,
} from '#/data/cinema/media-file/types.js'
import { getUploadReservation } from '#/data/iam/upload-reservation/get-upload-reservation.js'
import { isUniqueViolation } from '#/db/errors.js'
import { requireSuperAdmin } from '#/guards.js'
import { paged } from '#/lib/paging.js'
import { uuidSchema } from '#/lib/validation.js'
import type { ApiModule } from '#/server/modules.js'
import { finishUpload, releaseObject } from '#/services/quotas/index.js'

const MAGIC_HEAD_BYTES = 512

const QUICKTIME_BRAND = 'qt  '

const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'mp71',
  'M4V ',
  'M4VH',
  'M4VP',
  'f4v ',
  'dash',
  'msdh',
  'msix',
  'MSNV',
  'NDAS',
  'NDSC',
  'NDSH',
  'NDSM',
  'NDSP',
  'NDSS',
  'NDXC',
  'NDXH',
  'NDXM',
  'NDXP',
  'NDXS',
])

const MP4_COMPATIBLE_BRANDS = new Set([
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
])

const UNSUPPORTED_FTYP_FORMATS: Record<string, string> = {
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  hevx: 'image/heic',
  heim: 'image/heic',
  heis: 'image/heic',
  hevm: 'image/heic',
  hevs: 'image/heic',
  mif1: 'image/heic',
  msf1: 'image/heic',
  avif: 'image/avif',
  avis: 'image/avif',
  'M4A ': 'audio/mp4',
  'M4B ': 'audio/mp4',
  'M4P ': 'audio/mp4',
  'f4a ': 'audio/mp4',
  'f4b ': 'audio/mp4',
  'jp2 ': 'image/jp2',
  'jpx ': 'image/jpx',
  'jpm ': 'image/jpm',
  'jxl ': 'image/jxl',
}

const ASF_GUID = [
  0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00,
  0x62, 0xce, 0x6c,
]

const KIND_TO_WIRE: Record<MediaFileKindValue, MediaFileKind> = {
  original: MediaFileKind.ORIGINAL,
}

const CONTAINER_TO_WIRE: Record<MediaContainerValue, MediaContainer> = {
  mp4: MediaContainer.MP4,
  mov: MediaContainer.MOV,
}

type ContainerDetection =
  | { ok: true; container: MediaContainerValue }
  | { ok: false; detectedFormat: string }

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]!)
  }
  return out
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false
  }
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) {
      return false
    }
  }
  return true
}

function detectUnsupportedFormat(head: Uint8Array): string {
  // EBML header used by Matroska and WebM.
  if (hasPrefix(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    const text = asciiSlice(head, 0, Math.min(head.length, 128)).toLowerCase()
    return text.includes('webm') ? 'video/webm' : 'video/x-matroska'
  }
  if (
    head.length >= 12 &&
    asciiSlice(head, 0, 4) === 'RIFF' &&
    asciiSlice(head, 8, 12) === 'AVI '
  ) {
    return 'video/x-msvideo'
  }
  if (hasPrefix(head, [0x46, 0x4c, 0x56, 0x01])) {
    return 'video/x-flv'
  }
  if (head.length >= 4 && asciiSlice(head, 0, 4) === 'OggS') {
    return 'application/ogg'
  }
  if (hasPrefix(head, ASF_GUID)) {
    return 'video/x-ms-asf'
  }
  if (hasPrefix(head, [0x00, 0x00, 0x01, 0xba])) {
    return 'video/mpeg'
  }
  if (head.length >= 189 && head[0] === 0x47 && head[188] === 0x47) {
    return 'video/mp2t'
  }
  if (hasPrefix(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (hasPrefix(head, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (head.length >= 5 && asciiSlice(head, 0, 5) === '%PDF-') {
    return 'application/pdf'
  }
  if (hasPrefix(head, [0x50, 0x4b, 0x03, 0x04])) {
    return 'application/zip'
  }
  return ''
}

// Inspects the ISO BMFF ftyp box to accept MP4 or QuickTime MOV and identify common unsupported
// formats for error reporting.
function detectMediaContainer(head: Uint8Array): ContainerDetection {
  if (head.length >= 16 && asciiSlice(head, 4, 8) === 'ftyp') {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    const boxSize = view.getUint32(0, false)
    let brandOffset: number
    let brandsStart: number
    let brandsEnd: number

    if (boxSize === 1) {
      if (head.length < 24) {
        return { ok: false, detectedFormat: '' }
      }
      const extSize = view.getBigUint64(8, false)
      if (extSize < 24n) {
        return { ok: false, detectedFormat: '' }
      }
      brandOffset = 16
      brandsStart = 24
      brandsEnd = extSize < BigInt(head.length) ? Number(extSize) : head.length
    } else if (boxSize >= 16) {
      brandOffset = 8
      brandsStart = 16
      brandsEnd = Math.min(boxSize, head.length)
    } else {
      return { ok: false, detectedFormat: '' }
    }

    const majorBrand = asciiSlice(head, brandOffset, brandOffset + 4)
    if (majorBrand === QUICKTIME_BRAND) {
      return { ok: true, container: 'mov' }
    }
    const knownUnsupported = UNSUPPORTED_FTYP_FORMATS[majorBrand]
    if (knownUnsupported) {
      return { ok: false, detectedFormat: knownUnsupported }
    }
    if (majorBrand.startsWith('3gp') || majorBrand.startsWith('3g2')) {
      return { ok: false, detectedFormat: 'video/3gpp' }
    }
    if (MP4_BRANDS.has(majorBrand)) {
      return { ok: true, container: 'mp4' }
    }

    let hasQuickTime = false
    for (let offset = brandsStart; offset + 4 <= brandsEnd; offset += 4) {
      const brand = asciiSlice(head, offset, offset + 4)
      if (MP4_COMPATIBLE_BRANDS.has(brand)) {
        return { ok: true, container: 'mp4' }
      }
      if (brand === QUICKTIME_BRAND) {
        hasQuickTime = true
      }
    }
    if (hasQuickTime) {
      return { ok: true, container: 'mov' }
    }
    return { ok: false, detectedFormat: '' }
  }

  return { ok: false, detectedFormat: detectUnsupportedFormat(head) }
}

function unsupportedFormatError(detectedFormat: string): ConnectError {
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

function validateReservationId(raw: string): string {
  const id = raw.trim()
  if (!id) {
    throw new ConnectError('reservation_id is required', Code.InvalidArgument)
  }
  if (!uuidSchema.safeParse(id).success) {
    throw new ConnectError(
      'reservation_id is not a valid ID',
      Code.InvalidArgument,
    )
  }
  return id
}

function validateObjectId(raw: string): string {
  const id = raw.trim()
  if (!id) {
    throw new ConnectError('object_id is required', Code.InvalidArgument)
  }
  if (id === '.' || id === '..' || /[/\\]/.test(id)) {
    throw new ConnectError('object_id is not valid', Code.InvalidArgument)
  }
  return id
}

function filterFromWire(filter: MediaFileFilter): MediaFileFilterMode {
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

function mediaFileToWire(
  file: MediaFileDetails,
): MessageInitShape<typeof MediaFileSchema> {
  return {
    id: file.id,
    objectId: file.objectId,
    filename: file.filename,
    sizeBytes: file.sizeBytes,
    kind: KIND_TO_WIRE[file.kind],
    container: CONTAINER_TO_WIRE[file.container],
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

export const module: ApiModule = {
  name: 'cinema-library',
  rpc(router, ctx) {
    router.rpc(CinemaService.method.addMediaFile, async (req, call) => {
      const viewer = await requireSuperAdmin(call, ctx)
      const reservationId = validateReservationId(req.reservationId)
      const objectId = validateObjectId(req.objectId)

      const reservation = await getUploadReservation(ctx.db, reservationId)
      if (!reservation) {
        throw new ConnectError('no such reservation', Code.NotFound)
      }
      if (reservation.userId !== viewer.userId) {
        throw new ConnectError(
          'reservation belongs to someone else',
          Code.PermissionDenied,
        )
      }
      if (reservation.app !== 'cinema' || reservation.householdId !== null) {
        throw new ConnectError(
          'reservation must be a shared-library Cinema upload',
          Code.InvalidArgument,
        )
      }

      const finished = await finishUpload(ctx, {
        userId: viewer.userId,
        reservationId,
        objectId,
      })

      const existing = await getMediaFileByObjectId(ctx.db, objectId)
      if (existing) {
        return { file: mediaFileToWire(existing) }
      }

      const [head, stored] = await Promise.all([
        ctx.gateway.readHead(objectId, MAGIC_HEAD_BYTES),
        ctx.gateway.stat(objectId),
      ])
      if (!head || !stored) {
        await releaseObject(ctx, objectId)
        throw new ConnectError(
          'object not found on the Storage Gateway',
          Code.NotFound,
        )
      }

      const detected = detectMediaContainer(head)
      if (!detected.ok) {
        await releaseObject(ctx, objectId)
        throw unsupportedFormatError(detected.detectedFormat)
      }

      let row
      try {
        row = await createMediaFile(ctx.db, {
          objectId,
          filename: stored.filename,
          container: detected.container,
        })
      } catch (err) {
        if (isUniqueViolation(err)) {
          const raced = await getMediaFileByObjectId(ctx.db, objectId)
          if (raced) {
            return { file: mediaFileToWire(raced) }
          }
        }
        throw err
      }

      return {
        file: mediaFileToWire({
          id: row.id,
          objectId: row.objectId,
          filename: row.filename,
          sizeBytes: finished.bytes,
          kind: row.kind,
          container: row.container,
          addedAt: row.addedAt,
          movie: null,
          episode: null,
        }),
      }
    })

    router.rpc(CinemaService.method.listMediaFiles, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const filter = filterFromWire(req.filter)
      const { rows, nextPageToken } = await paged(
        req,
        (after, limit) => {
          if (after && !uuidSchema.safeParse(after.id).success) {
            throw new ConnectError(
              'page_token is not valid',
              Code.InvalidArgument,
            )
          }
          return getMediaFilePage(ctx.db, { filter, after, limit })
        },
        (f) => ({ createdAt: f.addedAt, id: f.id }),
      )
      return {
        files: rows.map(mediaFileToWire),
        nextPageToken,
      }
    })
  },
}
