import { likeContains, uuid, type PageCursor } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import {
  cinemaMediaFiles,
  cinemaMovies,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { and, desc, eq, ilike, isNotNull, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type {
  ContinueWatchingMovie,
  MovieWatchProgress,
  PlayableMovie,
} from './types.js'

const posterClaim = alias(iamObjectClaims, 'movie_poster_claim')
const backdropClaim = alias(iamObjectClaims, 'movie_backdrop_claim')

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

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

interface RawMovieRow {
  id: string
  tmdbId: number
  title: string
  overview: string
  releaseYear: number | null
  runtimeMinutes: number | null
  posterObjectId: string | null
  backdropObjectId: string | null
  createdAt: Date
  addedAt: Date | string
  progressPositionMs: bigint | null
  progressDurationMs: bigint | null
  progressFinished: boolean | null
  progressWatchCount: number | null
  progressUpdatedAt: Date | null
}

function toPlayableMovie(row: RawMovieRow): PlayableMovie {
  const progress: MovieWatchProgress | null =
    row.progressUpdatedAt !== null &&
    row.progressPositionMs !== null &&
    row.progressDurationMs !== null &&
    row.progressFinished !== null &&
    row.progressWatchCount !== null
      ? {
          positionMs: row.progressPositionMs,
          durationMs: row.progressDurationMs,
          finished: row.progressFinished,
          watchCount: row.progressWatchCount,
          updatedAt: row.progressUpdatedAt,
        }
      : null

  return {
    id: row.id,
    tmdbId: row.tmdbId,
    title: row.title,
    overview: row.overview,
    releaseYear: row.releaseYear,
    runtimeMinutes: row.runtimeMinutes,
    posterObjectId: row.posterObjectId,
    backdropObjectId: row.backdropObjectId,
    createdAt: row.createdAt,
    addedAt: toDate(row.addedAt),
    progress,
  }
}

function selectPlayableMovies(db: DbOrTx, userId: string) {
  const movieFiles = playableMovieFiles(db)
  const query = db
    .select({
      id: cinemaMovies.id,
      tmdbId: cinemaMovies.tmdbId,
      title: cinemaMovies.title,
      overview: cinemaMovies.overview,
      releaseYear: cinemaMovies.releaseYear,
      runtimeMinutes: cinemaMovies.runtimeMinutes,
      posterObjectId: posterClaim.objectId,
      backdropObjectId: backdropClaim.objectId,
      createdAt: cinemaMovies.createdAt,
      addedAt: movieFiles.addedAt,
      progressPositionMs: cinemaWatchProgress.positionMs,
      progressDurationMs: cinemaWatchProgress.durationMs,
      progressFinished: cinemaWatchProgress.finished,
      progressWatchCount: cinemaWatchProgress.watchCount,
      progressUpdatedAt: cinemaWatchProgress.updatedAt,
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
      and(
        eq(posterClaim.objectId, cinemaMovies.posterObjectId),
        isNull(posterClaim.releasedAt),
      ),
    )
    .leftJoin(
      backdropClaim,
      and(
        eq(backdropClaim.objectId, cinemaMovies.backdropObjectId),
        isNull(backdropClaim.releasedAt),
      ),
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
  const after = options.after
  const rows = await query
    .where(
      and(
        pattern ? ilike(cinemaMovies.title, pattern) : undefined,
        after
          ? sql`(date_trunc('milliseconds', ${cinemaMovies.createdAt}), ${cinemaMovies.id}) > (${after.createdAt.toISOString()}::timestamptz, ${uuid(after.id)})`
          : undefined,
      ),
    )
    .orderBy(
      sql`date_trunc('milliseconds', ${cinemaMovies.createdAt})`,
      cinemaMovies.id,
    )
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
        sql`${cinemaWatchProgress.positionMs} > 0`,
      ),
    )
    .orderBy(desc(cinemaWatchProgress.updatedAt), desc(cinemaMovies.id))
    .limit(options.limit)

  const items: ContinueWatchingMovie[] = []
  for (const row of rows) {
    const movie = toPlayableMovie(row)
    if (movie.progress) {
      items.push({ movie, progress: movie.progress })
    }
  }
  return items
}
