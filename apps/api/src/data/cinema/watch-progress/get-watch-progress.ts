import { uuid } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import {
  cinemaEpisodes,
  cinemaMovies,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { and, eq } from 'drizzle-orm'

import type { WatchProgressRow, WatchProgressTarget } from './types.js'

/** One person's saved progress for a movie or episode, or null when none exists. */
export async function getWatchProgress(
  db: DbOrTx,
  userId: string,
  target: WatchProgressTarget,
): Promise<WatchProgressRow | null> {
  const targetColumn =
    target.kind === 'movie'
      ? cinemaWatchProgress.movieId
      : cinemaWatchProgress.episodeId
  const [row] = await db
    .select()
    .from(cinemaWatchProgress)
    .where(
      and(
        eq(cinemaWatchProgress.userId, userId),
        eq(targetColumn, uuid(target.id)),
      ),
    )
    .limit(1)
    .catch(noRowsOnBadUuid)
  return row ?? null
}

/** True when the movie or episode named by target exists in the catalog. */
export async function watchProgressTargetExists(
  db: DbOrTx,
  target: WatchProgressTarget,
): Promise<boolean> {
  if (target.kind === 'movie') {
    const [row] = await db
      .select({ id: cinemaMovies.id })
      .from(cinemaMovies)
      .where(eq(cinemaMovies.id, uuid(target.id)))
      .limit(1)
      .catch(noRowsOnBadUuid)
    return row !== undefined
  }
  const [row] = await db
    .select({ id: cinemaEpisodes.id })
    .from(cinemaEpisodes)
    .where(eq(cinemaEpisodes.id, uuid(target.id)))
    .limit(1)
    .catch(noRowsOnBadUuid)
  return row !== undefined
}
