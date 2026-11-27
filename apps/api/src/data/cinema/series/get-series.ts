import {
  activeClaimOn,
  asDate,
  keysetAfterTz,
  keysetOrder,
  likeContains,
  uuid,
  type PageCursor,
} from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaSeries,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { PlayableSeriesSummary, SeriesHeader } from './types.js'

const posterClaim = alias(iamObjectClaims, 'series_poster_claim')
const backdropClaim = alias(iamObjectClaims, 'series_backdrop_claim')

function playableSeriesStats(db: DbOrTx, userId: string) {
  return db
    .select({
      seriesId: cinemaEpisodes.seriesId,
      addedAt: sql<Date | string>`max(${cinemaMediaFiles.addedAt})`.as(
        'series_added_at',
      ),
      totalEpisodeCount:
        sql<number>`count(distinct ${cinemaEpisodes.id})::int`.as(
          'total_episode_count',
        ),
      watchedEpisodeCount:
        sql<number>`count(distinct ${cinemaEpisodes.id}) filter (where ${cinemaWatchProgress.finished} is true)::int`.as(
          'watched_episode_count',
        ),
    })
    .from(cinemaEpisodes)
    .innerJoin(
      cinemaMediaFiles,
      eq(cinemaMediaFiles.episodeId, cinemaEpisodes.id),
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

function toPlayableSeriesSummary(row: {
  series: typeof cinemaSeries.$inferSelect
  posterObjectId: string | null
  backdropObjectId: string | null
  watchedEpisodeCount: number
  totalEpisodeCount: number
  addedAt: Date | string
}): PlayableSeriesSummary {
  return {
    id: row.series.id,
    tmdbId: row.series.tmdbId,
    title: row.series.title,
    overview: row.series.overview,
    firstAirYear: row.series.firstAirYear,
    posterObjectId: row.posterObjectId,
    backdropObjectId: row.backdropObjectId,
    watchedEpisodeCount: Number(row.watchedEpisodeCount),
    totalEpisodeCount: Number(row.totalEpisodeCount),
    createdAt: row.series.createdAt,
    addedAt: asDate(row.addedAt),
  }
}

function selectPlayableSeries(db: DbOrTx, userId: string) {
  const stats = playableSeriesStats(db, userId)
  const query = db
    .select({
      series: cinemaSeries,
      posterObjectId: posterClaim.objectId,
      backdropObjectId: backdropClaim.objectId,
      watchedEpisodeCount: stats.watchedEpisodeCount,
      totalEpisodeCount: stats.totalEpisodeCount,
      addedAt: stats.addedAt,
    })
    .from(cinemaSeries)
    .innerJoin(stats, eq(stats.seriesId, cinemaSeries.id))
    .leftJoin(
      posterClaim,
      activeClaimOn(posterClaim, cinemaSeries.posterObjectId),
    )
    .leftJoin(
      backdropClaim,
      activeClaimOn(backdropClaim, cinemaSeries.backdropObjectId),
    )
  return { query, stats }
}

/** Series titles and active art claims for a batch of series IDs. */
export async function getSeriesHeadersByIds(
  db: DbOrTx,
  seriesIds: string[],
): Promise<Map<string, SeriesHeader>> {
  if (seriesIds.length === 0) {
    return new Map()
  }
  const rows = await db
    .select({
      id: cinemaSeries.id,
      title: cinemaSeries.title,
      posterObjectId: posterClaim.objectId,
      backdropObjectId: backdropClaim.objectId,
    })
    .from(cinemaSeries)
    .leftJoin(
      posterClaim,
      activeClaimOn(posterClaim, cinemaSeries.posterObjectId),
    )
    .leftJoin(
      backdropClaim,
      activeClaimOn(backdropClaim, cinemaSeries.backdropObjectId),
    )
    .where(inArray(cinemaSeries.id, seriesIds))
  return new Map(rows.map((row) => [row.id, row]))
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
  const rows = await query
    .where(
      and(
        pattern ? ilike(cinemaSeries.title, pattern) : undefined,
        options.after
          ? keysetAfterTz(
              cinemaSeries.createdAt,
              cinemaSeries.id,
              options.after,
            )
          : undefined,
      ),
    )
    .orderBy(...keysetOrder(cinemaSeries.createdAt, cinemaSeries.id))
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
