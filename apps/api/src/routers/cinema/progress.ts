import type { MessageInitShape } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  CinemaService,
  type PlayableRef,
  type WatchProgressSchema,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { watchProgressTargetExists } from '#/data/cinema/watch-progress/get-watch-progress.js'
import type {
  WatchProgressRow,
  WatchProgressTarget,
} from '#/data/cinema/watch-progress/types.js'
import {
  setWatchProgressWatched,
  upsertWatchProgress,
} from '#/data/cinema/watch-progress/update-watch-progress.js'
import { requireApp } from '#/guards.js'
import { uuidSchema } from '#/lib/validation.js'
import type { ApiModule } from '#/server/modules.js'

const FINISH_THRESHOLD_PERCENT = 95n
const PERCENT_SCALE = 100n
// The largest millisecond count a Postgres bigint column holds.
const MAX_PROGRESS_MS = 2n ** 63n - 1n

function parseTarget(ref: PlayableRef | undefined): WatchProgressTarget {
  const target = ref?.target
  if (target?.case !== 'movieId' && target?.case !== 'episodeId') {
    throw new ConnectError(
      'target movie_id or episode_id is required',
      Code.InvalidArgument,
    )
  }
  const field = target.case === 'movieId' ? 'movie_id' : 'episode_id'
  const id = target.value.trim()
  if (!id) {
    throw new ConnectError(`${field} is required`, Code.InvalidArgument)
  }
  if (!uuidSchema.safeParse(id).success) {
    throw new ConnectError(`${field} is not a valid ID`, Code.InvalidArgument)
  }
  return target.case === 'movieId'
    ? { kind: 'movie', id }
    : { kind: 'episode', id }
}

function validateMs(value: bigint, field: string): bigint {
  if (value < 0n || value > MAX_PROGRESS_MS) {
    throw new ConnectError(
      `${field} must be between 0 and ${MAX_PROGRESS_MS}`,
      Code.InvalidArgument,
    )
  }
  return value
}

function hasReachedFinish(positionMs: bigint, durationMs: bigint): boolean {
  return (
    durationMs > 0n &&
    positionMs * PERCENT_SCALE >= durationMs * FINISH_THRESHOLD_PERCENT
  )
}

function notFoundError(target: WatchProgressTarget): ConnectError {
  return new ConnectError(
    target.kind === 'movie' ? 'movie not found' : 'episode not found',
    Code.NotFound,
  )
}

function progressToWire(
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

export const module: ApiModule = {
  name: 'cinema-progress',
  rpc(router, ctx) {
    router.rpc(CinemaService.method.reportProgress, async (req, call) => {
      const { viewer } = await requireApp(call, ctx, 'cinema', {
        allowSuperAdminWithoutHousehold: true,
      })
      const target = parseTarget(req.target)
      const positionMs = validateMs(req.positionMs, 'position_ms')
      const durationMs = validateMs(req.durationMs, 'duration_ms')

      if (!(await watchProgressTargetExists(ctx.db, target))) {
        throw notFoundError(target)
      }

      const row = await upsertWatchProgress(ctx.db, {
        userId: viewer.userId,
        target,
        positionMs,
        durationMs,
        finished: hasReachedFinish(positionMs, durationMs),
        now: new Date(),
      })
      if (!row) {
        throw notFoundError(target)
      }
      return { progress: progressToWire(row) }
    })

    router.rpc(CinemaService.method.setWatched, async (req, call) => {
      const { viewer } = await requireApp(call, ctx, 'cinema', {
        allowSuperAdminWithoutHousehold: true,
      })
      const target = parseTarget(req.target)

      if (!(await watchProgressTargetExists(ctx.db, target))) {
        throw notFoundError(target)
      }

      const row = await setWatchProgressWatched(ctx.db, {
        userId: viewer.userId,
        target,
        watched: req.watched,
        now: new Date(),
      })
      if (!row) {
        throw notFoundError(target)
      }
      return { progress: progressToWire(row) }
    })
  },
}
