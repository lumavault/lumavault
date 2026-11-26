import { uuid } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { cinemaWatchProgress } from '#/db/schemas/cinema.js'
import { and, eq } from 'drizzle-orm'

import type { WatchProgressRow, WatchProgressTarget } from './types.js'

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
