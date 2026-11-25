import { pgErrorCode } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { cinemaWatchProgress } from '#/db/schemas/cinema.js'
import { sql } from 'drizzle-orm'

import type {
  SetWatchedInput,
  UpsertWatchProgressInput,
  WatchProgressRow,
  WatchProgressTarget,
} from './types.js'

const FOREIGN_KEY_VIOLATION = '23503'
const TARGET_FK_CONSTRAINTS = new Set([
  'watch_progress_movie_id_movies_id_fk',
  'watch_progress_episode_id_episodes_id_fk',
])

function isMissingTargetFk(err: unknown): boolean {
  if (pgErrorCode(err) !== FOREIGN_KEY_VIOLATION) {
    return false
  }
  const constraint =
    (err as { cause?: { constraint?: string } }).cause?.constraint ??
    (err as { constraint?: string }).constraint
  return constraint !== undefined && TARGET_FK_CONSTRAINTS.has(constraint)
}

function conflictFor(target: WatchProgressTarget) {
  if (target.kind === 'movie') {
    return {
      columns: { movieId: target.id, episodeId: null },
      target: [cinemaWatchProgress.userId, cinemaWatchProgress.movieId],
      targetWhere: sql`${cinemaWatchProgress.movieId} is not null`,
    }
  }
  return {
    columns: { movieId: null, episodeId: target.id },
    target: [cinemaWatchProgress.userId, cinemaWatchProgress.episodeId],
    targetWhere: sql`${cinemaWatchProgress.episodeId} is not null`,
  }
}

/**
 * Inserts or updates a user's progress row from a playback report. Increments watchCount
 * atomically only when transitioning from unfinished to finished so repeated reports above
 * the completion threshold never double-count. Returns null if the target was deleted.
 */
export async function upsertWatchProgress(
  db: DbOrTx,
  input: UpsertWatchProgressInput,
): Promise<WatchProgressRow | null> {
  const conflict = conflictFor(input.target)
  const watchCountUpdate = input.finished
    ? sql`case when not ${cinemaWatchProgress.finished} then ${cinemaWatchProgress.watchCount} + 1 else ${cinemaWatchProgress.watchCount} end`
    : cinemaWatchProgress.watchCount

  try {
    const [row] = await db
      .insert(cinemaWatchProgress)
      .values({
        userId: input.userId,
        ...conflict.columns,
        positionMs: input.positionMs,
        durationMs: input.durationMs,
        finished: input.finished,
        watchCount: input.finished ? 1 : 0,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: conflict.target,
        targetWhere: conflict.targetWhere,
        set: {
          positionMs: input.positionMs,
          durationMs: input.durationMs,
          finished: input.finished,
          watchCount: watchCountUpdate,
          updatedAt: input.now,
        },
      })
      .returning()
    return row ?? null
  } catch (err) {
    if (isMissingTargetFk(err)) {
      return null
    }
    throw err
  }
}

/**
 * Manually marks a movie or episode watched or unwatched, clearing positionMs to zero while
 * keeping any previously recorded durationMs. Marking watched increments watchCount on the
 * transition from unfinished to finished and stays idempotent when already finished. Returns
 * null if the target was deleted.
 */
export async function setWatchProgressWatched(
  db: DbOrTx,
  input: SetWatchedInput,
): Promise<WatchProgressRow | null> {
  const conflict = conflictFor(input.target)
  const set = input.watched
    ? {
        positionMs: 0n,
        finished: true,
        watchCount: sql`case when not ${cinemaWatchProgress.finished} then ${cinemaWatchProgress.watchCount} + 1 else greatest(${cinemaWatchProgress.watchCount}, 1) end`,
        updatedAt: input.now,
      }
    : {
        positionMs: 0n,
        finished: false,
        updatedAt: input.now,
      }

  try {
    const [row] = await db
      .insert(cinemaWatchProgress)
      .values({
        userId: input.userId,
        ...conflict.columns,
        positionMs: 0n,
        durationMs: 0n,
        finished: input.watched,
        watchCount: input.watched ? 1 : 0,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: conflict.target,
        targetWhere: conflict.targetWhere,
        set,
      })
      .returning()
    return row ?? null
  } catch (err) {
    if (isMissingTargetFk(err)) {
      return null
    }
    throw err
  }
}
