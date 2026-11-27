import { isForeignKeyViolation, isUniqueViolation } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { cinemaWatchProgress } from '#/db/schemas/cinema.js'
import { eq } from 'drizzle-orm'

import { getWatchProgressForUpdate } from './get-watch-progress.js'
import type {
  SetWatchedInput,
  UpsertWatchProgressInput,
  WatchProgressRow,
  WatchProgressTarget,
} from './types.js'

const TARGET_FK_CONSTRAINTS = new Set([
  'watch_progress_movie_id_movies_id_fk',
  'watch_progress_episode_id_episodes_id_fk',
])

type WatchProgressInsert = Pick<
  WatchProgressRow,
  'positionMs' | 'durationMs' | 'finished' | 'watchCount' | 'updatedAt'
>
type WatchProgressPatch = Partial<WatchProgressInsert>

function targetColumns(target: WatchProgressTarget) {
  return target.kind === 'movie'
    ? { movieId: target.id, episodeId: null }
    : { movieId: null, episodeId: target.id }
}

/**
 * Locks and updates a user's progress row, or inserts it when missing. Retries once if two
 * first-time writes race on the unique index, and returns null when the target does not exist.
 */
async function saveWatchProgress(
  db: DbOrTx,
  userId: string,
  target: WatchProgressTarget,
  build: {
    insert: () => WatchProgressInsert
    update: (existing: WatchProgressRow) => WatchProgressPatch
  },
): Promise<WatchProgressRow | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const existing = await getWatchProgressForUpdate(tx, userId, target)
        if (existing) {
          const [updated] = await tx
            .update(cinemaWatchProgress)
            .set(build.update(existing))
            .where(eq(cinemaWatchProgress.id, existing.id))
            .returning()
          return updated ?? null
        }
        const [inserted] = await tx
          .insert(cinemaWatchProgress)
          .values({
            userId,
            ...targetColumns(target),
            ...build.insert(),
          })
          .returning()
        return inserted ?? null
      })
    } catch (err) {
      if (isForeignKeyViolation(err, TARGET_FK_CONSTRAINTS)) {
        return null
      }
      if (attempt === 0 && isUniqueViolation(err)) {
        continue
      }
      throw err
    }
  }
  return null
}

/**
 * Inserts or updates a user's progress row from a playback report. Increments watchCount
 * only when transitioning from unfinished to finished so repeated reports above the
 * completion threshold never double-count. Returns null if the target does not exist.
 */
export function upsertWatchProgress(
  db: DbOrTx,
  input: UpsertWatchProgressInput,
): Promise<WatchProgressRow | null> {
  return saveWatchProgress(db, input.userId, input.target, {
    insert: () => ({
      positionMs: input.positionMs,
      durationMs: input.durationMs,
      finished: input.finished,
      watchCount: input.finished ? 1 : 0,
      updatedAt: input.now,
    }),
    update: (existing) => ({
      positionMs: input.positionMs,
      durationMs: input.durationMs,
      finished: input.finished,
      watchCount:
        input.finished && !existing.finished
          ? existing.watchCount + 1
          : existing.watchCount,
      updatedAt: input.now,
    }),
  })
}

/**
 * Manually marks a movie or episode watched or unwatched, clearing positionMs to zero while
 * keeping any previously recorded durationMs. Marking watched increments watchCount on the
 * transition from unfinished to finished and stays idempotent when already finished. Returns
 * null if the target does not exist.
 */
export function setWatchProgressWatched(
  db: DbOrTx,
  input: SetWatchedInput,
): Promise<WatchProgressRow | null> {
  return saveWatchProgress(db, input.userId, input.target, {
    insert: () => ({
      positionMs: 0n,
      durationMs: 0n,
      finished: input.watched,
      watchCount: input.watched ? 1 : 0,
      updatedAt: input.now,
    }),
    update: (existing) =>
      input.watched
        ? {
            positionMs: 0n,
            finished: true,
            watchCount: existing.finished
              ? Math.max(existing.watchCount, 1)
              : existing.watchCount + 1,
            updatedAt: input.now,
          }
        : {
            positionMs: 0n,
            finished: false,
            updatedAt: input.now,
          },
  })
}
