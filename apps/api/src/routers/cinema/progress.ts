import { CinemaService } from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import {
  setWatchProgressWatched,
  upsertWatchProgress,
} from '#/data/cinema/watch-progress.js'
import { requireApp } from '#/guards.js'
import { parseNonNegativeBigint } from '#/lib/validation.js'
import type { ApiModule } from '#/server/modules.js'

import {
  hasReachedFinish,
  playableRefFromWire,
  progressToWire,
  targetNotFoundError,
} from './convert.js'

export const module: ApiModule = {
  name: 'cinema-progress',
  rpc(router, ctx) {
    router.rpc(CinemaService.method.reportProgress, async (req, call) => {
      const { viewer } = await requireApp(call, ctx, 'cinema', {
        allowSuperAdminWithoutHousehold: true,
      })
      const target = playableRefFromWire(req.target)
      const positionMs = parseNonNegativeBigint(req.positionMs, 'position_ms')
      const durationMs = parseNonNegativeBigint(req.durationMs, 'duration_ms')

      const row = await upsertWatchProgress(ctx.db, {
        userId: viewer.userId,
        target,
        positionMs,
        durationMs,
        finished: hasReachedFinish(positionMs, durationMs),
        now: new Date(),
      })
      if (!row) {
        throw targetNotFoundError(target)
      }
      return { progress: progressToWire(row) }
    })

    router.rpc(CinemaService.method.setWatched, async (req, call) => {
      const { viewer } = await requireApp(call, ctx, 'cinema', {
        allowSuperAdminWithoutHousehold: true,
      })
      const target = playableRefFromWire(req.target)

      const row = await setWatchProgressWatched(ctx.db, {
        userId: viewer.userId,
        target,
        watched: req.watched,
        now: new Date(),
      })
      if (!row) {
        throw targetNotFoundError(target)
      }
      return { progress: progressToWire(row) }
    })
  },
}
