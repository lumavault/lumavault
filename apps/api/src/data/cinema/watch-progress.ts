import { uuid } from '#/data/sql.js'
import {
  isForeignKeyViolation,
  isUniqueViolation,
  noRowsOnBadUuid,
} from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { cinemaWatchProgress } from '#/db/schemas/cinema.js'
import { and, eq } from 'drizzle-orm'

/** One person's playback state for a single movie or episode. */
export type WatchProgressRow = typeof cinemaWatchProgress.$inferSelect

/** Identifies either a movie or an episode in cinema.watch_progress. */
export type WatchProgressTarget =
  { kind: 'movie'; id: string } | { kind: 'episode'; id: string }

/** Values written when a client reports playback progress. */
export interface UpsertWatchProgressInput {
  userId: string
  target: WatchProgressTarget
  positionMs: bigint
  durationMs: bigint
  finished: boolean
  now: Date
}

/** Values written when a user manually marks a title watched or unwatched. */
export interface SetWatchedInput {
  userId: string
  target: WatchProgressTarget
  watched: boolean
  now: Date
}

const TARGET_FK_CONSTRAINTS = new Set([
  'watch_progress_movie_id_movies_id_fk',
  'watch_progress_episode_id_episodes_id_fk',
])

type WatchProgressInsert = Pick<
  WatchProgressRow,
  'positionMs' | 'durationMs' | 'finished' | 'watchCount' | 'updatedAt'
>
type WatchProgressPatch = Partial<WatchProgressInsert>

function targetWhere(userId: string, target: WatchProgressTarget) {
  const column =
    target.kind === 'movie'
      ? cinemaWatchProgress.movieId
      : cinemaWatchProgress.episodeId
  return and(
    eq(cinemaWatchProgress.userId, userId),
    eq(column, uuid(target.id)),
  )
}

function targetColumns(target: WatchProgressTarget) {
  return target.kind === 'movie'
    ? { movieId: target.id, episodeId: null }
    : { movieId: null, episodeId: target.id }
}

/** One person's saved progress for a movie or episode, or null when none exists. */
export async function getWatchProgress(
  db: DbOrTx,
  userId: string,
  target: WatchProgressTarget,
): Promise<WatchProgressRow | null> {
  const [row] = await db
    .select()
    .from(cinemaWatchProgress)
    .where(targetWhere(userId, target))
    .limit(1)
    .catch(noRowsOnBadUuid)
  return row ?? null
}

/** One person's saved progress locked until the transaction ends, or null when none exists. */
export async function getWatchProgressForUpdate(
  db: DbOrTx,
  userId: string,
  target: WatchProgressTarget,
): Promise<WatchProgressRow | null> {
  const [row] = await db
    .select()
    .from(cinemaWatchProgress)
    .where(targetWhere(userId, target))
    .for('update')
    .limit(1)
    .catch(noRowsOnBadUuid)
  return row ?? null
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
