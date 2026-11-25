import { likeContains, uuid, type PageCursor } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaSeries,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { and, desc, eq, ilike, isNotNull, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { PlayableSeriesSummary } from './types.js'

const posterClaim = alias(iamObjectClaims, 'series_poster_claim')
const backdropClaim = alias(iamObjectClaims, 'series_backdrop_claim')

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function playableSeriesStats(db: DbOrTx, userId: string) {
  const playableEpisodes = db
    .select({
      episodeId: cinemaMediaFiles.episodeId,
      addedAt: sql<Date | string>`max(${cinemaMediaFiles.addedAt})`.as(
        'episode_added_at',
      ),
    })
    .from(cinemaMediaFiles)
    .where(isNotNull(cinemaMediaFiles.episodeId))
    .groupBy(cinemaMediaFiles.episodeId)
    .as('playable_episodes')

  return db
    .select({
      seriesId: cinemaEpisodes.seriesId,
      addedAt: sql<Date | string>`max(${playableEpisodes.addedAt})`.as(
        'series_added_at',
      ),
      totalEpisodeCount: sql<number>`count(*)::int`.as('total_episode_count'),
      watchedEpisodeCount:
        sql<number>`count(*) filter (where ${cinemaWatchProgress.finished} is true)::int`.as(
          'watched_episode_count',
        ),
    })
    .from(cinemaEpisodes)
    .innerJoin(
      playableEpisodes,
      eq(playableEpisodes.episodeId, cinemaEpisodes.id),
    )
    .leftJoin(
      cinemaWatchProgress,
      and(
        eq(cinemaWatchProgress.episodeId, cinemaEpisodes.id),
        eq(cinemaWatchProgress.userId, userId),
      ),
    )
    .groupBy(cinemaEpisodes.seriesId)
    .as('series_stats')
}

interface RawSeriesRow {
  id: string
  tmdbId: number
  title: string
  overview: string
  firstAirYear: number | null
  posterObjectId: string | null
  backdropObjectId: string | null
  watchedEpisodeCount: number
  totalEpisodeCount: number
  createdAt: Date
  addedAt: Date | string
}

function toPlayableSeriesSummary(row: RawSeriesRow): PlayableSeriesSummary {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    title: row.title,
    overview: row.overview,
    firstAirYear: row.firstAirYear,
    posterObjectId: row.posterObjectId,
    backdropObjectId: row.backdropObjectId,
    watchedEpisodeCount: Number(row.watchedEpisodeCount),
    totalEpisodeCount: Number(row.totalEpisodeCount),
    createdAt: row.createdAt,
    addedAt: toDate(row.addedAt),
  }
}

function selectPlayableSeries(db: DbOrTx, userId: string) {
  const stats = playableSeriesStats(db, userId)
  const query = db
    .select({
      id: cinemaSeries.id,
      tmdbId: cinemaSeries.tmdbId,
      title: cinemaSeries.title,
      overview: cinemaSeries.overview,
      firstAirYear: cinemaSeries.firstAirYear,
      posterObjectId: posterClaim.objectId,
      backdropObjectId: backdropClaim.objectId,
      watchedEpisodeCount: stats.watchedEpisodeCount,
      totalEpisodeCount: stats.totalEpisodeCount,
      createdAt: cinemaSeries.createdAt,
      addedAt: stats.addedAt,
    })
    .from(cinemaSeries)
    .innerJoin(stats, eq(stats.seriesId, cinemaSeries.id))
    .leftJoin(
      posterClaim,
      and(
        eq(posterClaim.objectId, cinemaSeries.posterObjectId),
        isNull(posterClaim.releasedAt),
      ),
    )
    .leftJoin(
      backdropClaim,
      and(
        eq(backdropClaim.objectId, cinemaSeries.backdropObjectId),
        isNull(backdropClaim.releasedAt),
      ),
    )
  return { query, stats }
}

/** One playable series summary with caller counts, or null when missing or it has no playable episodes. */
export async function getPlayableSeriesById(
  db: DbOrTx,
  seriesId: string,
  userId: string,
): Promise<PlayableSeriesSummary | null> {
  const { query } = selectPlayableSeries(db, userId)
  const [row] = await query
    .where(eq(cinemaSeries.id, uuid(seriesId)))
    .limit(1)
    .catch(noRowsOnBadUuid)
  return row ? toPlayableSeriesSummary(row) : null
}

/** A cursor-paged slice of playable series ordered by creation time and ID, with optional title search. */
export async function getPlayableSeriesPage(
  db: DbOrTx,
  options: {
    userId: string
    query?: string
    after?: PageCursor
    limit: number
  },
): Promise<PlayableSeriesSummary[]> {
  const { query } = selectPlayableSeries(db, options.userId)
  const pattern = options.query ? likeContains(options.query) : undefined
  const after = options.after
  const rows = await query
    .where(
      and(
        pattern ? ilike(cinemaSeries.title, pattern) : undefined,
        after
          ? sql`(date_trunc('milliseconds', ${cinemaSeries.createdAt}), ${cinemaSeries.id}) > (${after.createdAt.toISOString()}::timestamptz, ${uuid(after.id)})`
          : undefined,
      ),
    )
    .orderBy(
      sql`date_trunc('milliseconds', ${cinemaSeries.createdAt})`,
      cinemaSeries.id,
    )
    .limit(options.limit)
  return rows.map(toPlayableSeriesSummary)
}

/** Playable series ordered by most recently added episode media file first. */
export async function getRecentlyAddedSeries(
  db: DbOrTx,
  options: { userId: string; limit: number },
): Promise<PlayableSeriesSummary[]> {
  const { query, stats } = selectPlayableSeries(db, options.userId)
  const rows = await query
    .orderBy(desc(stats.addedAt), desc(cinemaSeries.id))
    .limit(options.limit)
  return rows.map(toPlayableSeriesSummary)
}
