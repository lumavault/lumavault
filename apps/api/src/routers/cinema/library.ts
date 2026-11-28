import { Code, ConnectError } from '@connectrpc/connect'
import { CinemaService } from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { createMediaFile } from '#/data/cinema/media-file/create-media-file.js'
import { deleteMediaFile } from '#/data/cinema/media-file/delete-media-file.js'
import {
  getMediaFileById,
  getMediaFileByObjectId,
  getMediaFilePage,
} from '#/data/cinema/media-file/get-media-file.js'
import { getUploadReservation } from '#/data/iam/upload-reservation/get-upload-reservation.js'
import { isUniqueViolation } from '#/db/errors.js'
import { requireSuperAdmin } from '#/guards.js'
import { MEDIA_CONTAINER_HEAD_BYTES } from '#/lib/constants.js'
import { detectMediaContainer } from '#/lib/media-container.js'
import { paged } from '#/lib/paging.js'
import {
  parseInput,
  requiredObjectIdSchema,
  requiredUuidSchema,
  uuidSchema,
} from '#/lib/validation.js'
import type { ApiModule } from '#/server/modules.js'
import { finishUpload, releaseObject } from '#/services/quotas/index.js'

import {
  mediaFileFilterFromWire,
  mediaFileToWire,
  unsupportedMediaFormatError,
} from './convert.js'

const reservationIdSchema = requiredUuidSchema('reservation_id')
const objectIdSchema = requiredObjectIdSchema('object_id')
const mediaFileIdSchema = requiredUuidSchema('media_file_id')

export const module: ApiModule = {
  name: 'cinema-library',
  rpc(router, ctx) {
    router.rpc(CinemaService.method.addMediaFile, async (req, call) => {
      const viewer = await requireSuperAdmin(call, ctx)
      const reservationId = parseInput(reservationIdSchema, req.reservationId)
      const objectId = parseInput(objectIdSchema, req.objectId)

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
        ctx.gateway.readHead(objectId, MEDIA_CONTAINER_HEAD_BYTES),
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
        throw unsupportedMediaFormatError(detected.detectedFormat)
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
          file: row,
          sizeBytes: finished.bytes,
          movie: null,
          episode: null,
          series: null,
        }),
      }
    })

    router.rpc(CinemaService.method.listMediaFiles, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const filter = mediaFileFilterFromWire(req.filter)
      const { rows, nextPageToken } = await paged(
        req,
        (after, limit) => {
          if (after) {
            parseInput(uuidSchema, after.id, 'page_token is not valid')
          }
          return getMediaFilePage(ctx.db, { filter, after, limit })
        },
        (d) => ({ createdAt: d.file.addedAt, id: d.file.id }),
      )
      return {
        files: rows.map(mediaFileToWire),
        nextPageToken,
      }
    })

    router.rpc(CinemaService.method.deleteMediaFile, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const mediaFileId = parseInput(mediaFileIdSchema, req.mediaFileId)

      const existing = await getMediaFileById(ctx.db, mediaFileId)
      if (!existing) {
        return {}
      }

      // Release before deleting the row so a failed Gateway delete stays retryable.
      await releaseObject(ctx, existing.file.objectId)
      await deleteMediaFile(ctx.db, mediaFileId)
      return {}
    })
  },
}
