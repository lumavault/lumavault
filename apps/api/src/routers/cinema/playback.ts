import { CinemaService } from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { getOriginalMediaFileByTarget } from '#/data/cinema/media-file/get-media-file.js'
import { getWatchProgress } from '#/data/cinema/watch-progress/get-watch-progress.js'
import type { ApiModule } from '#/server/modules.js'

import {
  createMediaUrlSigner,
  downloadToWire,
  noDownloadableFileError,
  noPlayableSourceError,
  playableRefFromWire,
  playbackSourceToWire,
  requireCinemaAccess,
  resumePositionFromProgress,
  targetNotFoundError,
} from './convert.js'

export const module: ApiModule = {
  name: 'cinema-playback',
  rpc(router, ctx) {
    const signMediaUrl = createMediaUrlSigner(ctx)

    router.rpc(CinemaService.method.getPlayback, async (req, call) => {
      const { viewer } = await requireCinemaAccess(call, ctx)
      const target = playableRefFromWire(req.target)

      const [lookup, progress] = await Promise.all([
        getOriginalMediaFileByTarget(ctx.db, target),
        getWatchProgress(ctx.db, viewer.userId, target),
      ])
      if (lookup.status === 'missing_target') {
        throw targetNotFoundError(target)
      }
      if (lookup.status === 'no_file') {
        throw noPlayableSourceError(target)
      }

      // v1 ignores PlaybackCapabilities and always returns the original file.
      const signed = signMediaUrl(lookup.source.file.objectId)
      return {
        sources: [playbackSourceToWire(lookup.source.file, signed)],
        resumePositionMs: resumePositionFromProgress(progress),
        durationMs: progress?.durationMs ?? 0n,
      }
    })

    router.rpc(CinemaService.method.getDownload, async (req, call) => {
      await requireCinemaAccess(call, ctx)
      const target = playableRefFromWire(req.target)

      const lookup = await getOriginalMediaFileByTarget(ctx.db, target)
      if (lookup.status === 'missing_target') {
        throw targetNotFoundError(target)
      }
      if (lookup.status === 'no_file') {
        throw noDownloadableFileError(target)
      }

      const signed = signMediaUrl(lookup.source.file.objectId, {
        download: true,
      })
      return downloadToWire(lookup.source, signed)
    })
  },
}
