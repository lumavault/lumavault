// Conversions and shared helpers between CinemaService wire types and the API's own values.
// Shared by the Cinema router files; it registers no RPCs itself.
import type { MessageInitShape } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import type {
  PlayableRef,
  WatchProgressSchema,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import type {
  WatchProgressRow,
  WatchProgressTarget,
} from '#/data/cinema/watch-progress/types.js'
import { parseInput, requiredUuidSchema } from '#/lib/validation.js'
import { z } from 'zod'

import { FINISH_THRESHOLD_PERCENT, PERCENT_SCALE } from './constants.js'

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
