import {
  activeClaimOn,
  asDate,
  big,
  keysetAfterTz,
  keysetOrder,
  likeContains,
  uuid,
  type PageCursor,
} from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import {
  cinemaMediaFiles,
  cinemaMovies,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { and, desc, eq, gt, ilike, isNotNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { WatchProgressRow } from './watch-progress.js'

/** A movie that has at least one playable media file, with active art and the caller's progress. */
export interface PlayableMovie {
  id: string
  tmdbId: number
  title: string
  overview: string
  releaseYear: number | null
  runtimeMinutes: number | null
  posterObjectId: string | null
  backdropObjectId: string | null
  createdAt: Date
  addedAt: Date
  progress: WatchProgressRow | null
}

/** A caller's in-progress playable movie for the Continue Watching row. */
export interface ContinueWatchingMovie {
  movie: PlayableMovie
  progress: WatchProgressRow
}

const posterClaim = alias(iamObjectClaims, 'movie_poster_claim')
const backdropClaim = alias(iamObjectClaims, 'movie_backdrop_claim')

function playableMovieFiles(db: DbOrTx) {
  return db
    .select({
      movieId: cinemaMediaFiles.movieId,
      addedAt: sql<Date | string>`max(${cinemaMediaFiles.addedAt})`.as(
        'movie_added_at',
      ),
    })
    .from(cinemaMediaFiles)
    .where(isNotNull(cinemaMediaFiles.movieId))
    .groupBy(cinemaMediaFiles.movieId)
    .as('movie_files')
}

function toPlayableMovie(row: {
  movie: typeof cinemaMovies.$inferSelect
  posterObjectId: string | null
  backdropObjectId: string | null
  addedAt: Date | string
  progress: WatchProgressRow | null
}): PlayableMovie {
  return {
    id: row.movie.id,
    tmdbId: row.movie.tmdbId,
    title: row.movie.title,
    overview: row.movie.overview,
    releaseYear: row.movie.releaseYear,
    runtimeMinutes: row.movie.runtimeMinutes,
    posterObjectId: row.posterObjectId,
    backdropObjectId: row.backdropObjectId,
    createdAt: row.movie.createdAt,
    addedAt: asDate(row.addedAt),
    progress: row.progress,
  }
}

function selectPlayableMovies(db: DbOrTx, userId: string) {
  const movieFiles = playableMovieFiles(db)
  const query = db
    .select({
      movie: cinemaMovies,
      posterObjectId: posterClaim.objectId,
      backdropObjectId: backdropClaim.objectId,
      addedAt: movieFiles.addedAt,
      progress: cinemaWatchProgress,
    })
    .from(cinemaMovies)
    .innerJoin(movieFiles, eq(movieFiles.movieId, cinemaMovies.id))
    .leftJoin(
      cinemaWatchProgress,
      and(
        eq(cinemaWatchProgress.movieId, cinemaMovies.id),
        eq(cinemaWatchProgress.userId, userId),
      ),
    )
    .leftJoin(
      posterClaim,
      activeClaimOn(posterClaim, cinemaMovies.posterObjectId),
    )
    .leftJoin(
      backdropClaim,
      activeClaimOn(backdropClaim, cinemaMovies.backdropObjectId),
    )
  return { query, movieFiles }
}

/** One playable movie with the caller's progress, or null when missing or it has no files. */
export async function getPlayableMovieById(
  db: DbOrTx,
  movieId: string,
  userId: string,
): Promise<PlayableMovie | null> {
  const { query } = selectPlayableMovies(db, userId)
  const [row] = await query
    .where(eq(cinemaMovies.id, uuid(movieId)))
    .limit(1)
    .catch(noRowsOnBadUuid)
  return row ? toPlayableMovie(row) : null
}

/** A cursor-paged slice of playable movies ordered by creation time and ID, with optional title search. */
export async function getPlayableMoviesPage(
  db: DbOrTx,
  options: {
    userId: string
    query?: string
    after?: PageCursor
    limit: number
  },
): Promise<PlayableMovie[]> {
  const { query } = selectPlayableMovies(db, options.userId)
  const pattern = options.query ? likeContains(options.query) : undefined
  const rows = await query
    .where(
      and(
        pattern ? ilike(cinemaMovies.title, pattern) : undefined,
        options.after
          ? keysetAfterTz(
              cinemaMovies.createdAt,
              cinemaMovies.id,
              options.after,
            )
          : undefined,
      ),
    )
    .orderBy(...keysetOrder(cinemaMovies.createdAt, cinemaMovies.id))
    .limit(options.limit)
  return rows.map(toPlayableMovie)
}

/** Playable movies ordered by most recently added media file first. */
export async function getRecentlyAddedMovies(
  db: DbOrTx,
  options: { userId: string; limit: number },
): Promise<PlayableMovie[]> {
  const { query, movieFiles } = selectPlayableMovies(db, options.userId)
  const rows = await query
    .orderBy(desc(movieFiles.addedAt), desc(cinemaMovies.id))
    .limit(options.limit)
  return rows.map(toPlayableMovie)
}

/** Playable movies the caller started and has not finished, ordered by latest progress update. */
export async function getContinueWatchingMovies(
  db: DbOrTx,
  options: { userId: string; limit: number },
): Promise<ContinueWatchingMovie[]> {
  const { query } = selectPlayableMovies(db, options.userId)
  const rows = await query
    .where(
      and(
        eq(cinemaWatchProgress.userId, options.userId),
        eq(cinemaWatchProgress.finished, false),
        gt(cinemaWatchProgress.positionMs, big(0n)),
      ),
    )
    .orderBy(desc(cinemaWatchProgress.updatedAt), desc(cinemaMovies.id))
    .limit(options.limit)

  return rows.flatMap((row) => {
    const movie = toPlayableMovie(row)
    return movie.progress ? [{ movie, progress: movie.progress }] : []
  })
}
