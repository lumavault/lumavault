import { uuid } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaSeries,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type {
  ContinueWatchingEpisodeRow,
  EpisodeWatchProgress,
  PlayableEpisode,
} from './types.js'

const stillClaim = alias(iamObjectClaims, 'episode_still_claim')
const seriesPosterClaim = alias(iamObjectClaims, 'cw_series_poster_claim')
const seriesBackdropClaim = alias(iamObjectClaims, 'cw_series_backdrop_claim')

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function playableEpisodeFiles(db: DbOrTx) {
  return db
    .select({
      episodeId: cinemaMediaFiles.episodeId,
      addedAt: sql<Date | string>`max(${cinemaMediaFiles.addedAt})`.as(
        'episode_added_at',
      ),
    })
    .from(cinemaMediaFiles)
    .where(isNotNull(cinemaMediaFiles.episodeId))
    .groupBy(cinemaMediaFiles.episodeId)
    .as('episode_files')
}

interface RawEpisodeRow {
  id: string
  seriesId: string
  tmdbId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  overview: string
  runtimeMinutes: number | null
  stillObjectId: string | null
  airDate: string | null
  addedAt: Date | string
  progressPositionMs: bigint | null
  progressDurationMs: bigint | null
  progressFinished: boolean | null
  progressWatchCount: number | null
  progressUpdatedAt: Date | null
}

function toPlayableEpisode(row: RawEpisodeRow): PlayableEpisode {
  const progress: EpisodeWatchProgress | null =
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
    seriesId: row.seriesId,
    tmdbId: row.tmdbId,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    title: row.title,
    overview: row.overview,
    runtimeMinutes: row.runtimeMinutes,
    stillObjectId: row.stillObjectId,
    airDate: row.airDate,
    addedAt: toDate(row.addedAt),
    progress,
  }
}

/** All playable episodes of one series ordered by season and episode number ascending. */
export async function getPlayableEpisodesBySeriesId(
  db: DbOrTx,
  seriesId: string,
  userId: string,
): Promise<PlayableEpisode[]> {
  const episodeFiles = playableEpisodeFiles(db)
  const rows = await db
    .select({
      id: cinemaEpisodes.id,
      seriesId: cinemaEpisodes.seriesId,
      tmdbId: cinemaEpisodes.tmdbId,
      seasonNumber: cinemaEpisodes.seasonNumber,
      episodeNumber: cinemaEpisodes.episodeNumber,
      title: cinemaEpisodes.title,
      overview: cinemaEpisodes.overview,
      runtimeMinutes: cinemaEpisodes.runtimeMinutes,
      stillObjectId: stillClaim.objectId,
      airDate: cinemaEpisodes.airDate,
      addedAt: episodeFiles.addedAt,
      progressPositionMs: cinemaWatchProgress.positionMs,
      progressDurationMs: cinemaWatchProgress.durationMs,
      progressFinished: cinemaWatchProgress.finished,
      progressWatchCount: cinemaWatchProgress.watchCount,
      progressUpdatedAt: cinemaWatchProgress.updatedAt,
    })
    .from(cinemaEpisodes)
    .innerJoin(episodeFiles, eq(episodeFiles.episodeId, cinemaEpisodes.id))
    .leftJoin(
      cinemaWatchProgress,
      and(
        eq(cinemaWatchProgress.episodeId, cinemaEpisodes.id),
        eq(cinemaWatchProgress.userId, userId),
      ),
    )
    .leftJoin(
      stillClaim,
      and(
        eq(stillClaim.objectId, cinemaEpisodes.stillObjectId),
        isNull(stillClaim.releasedAt),
      ),
    )
    .where(eq(cinemaEpisodes.seriesId, uuid(seriesId)))
    .orderBy(
      asc(cinemaEpisodes.seasonNumber),
      asc(cinemaEpisodes.episodeNumber),
    )
    .catch(noRowsOnBadUuid)

  return rows.map(toPlayableEpisode)
}

function isAfterEpisode(
  candidate: PlayableEpisode,
  seasonNumber: number,
  episodeNumber: number,
): boolean {
  return (
    candidate.seasonNumber > seasonNumber ||
    (candidate.seasonNumber === seasonNumber &&
      candidate.episodeNumber > episodeNumber)
  )
}

/**
 * In-progress episodes and queued next unwatched episodes after a finished episode, at most
 * one entry per series, ordered by the caller's most recent activity.
 */
export async function getContinueWatchingEpisodes(
  db: DbOrTx,
  options: { userId: string; limit: number },
): Promise<ContinueWatchingEpisodeRow[]> {
  const activityRows = await db
    .select({
      episodeId: cinemaEpisodes.id,
      seriesId: cinemaEpisodes.seriesId,
      seasonNumber: cinemaEpisodes.seasonNumber,
      episodeNumber: cinemaEpisodes.episodeNumber,
      positionMs: cinemaWatchProgress.positionMs,
      finished: cinemaWatchProgress.finished,
      updatedAt: cinemaWatchProgress.updatedAt,
    })
    .from(cinemaWatchProgress)
    .innerJoin(
      cinemaEpisodes,
      eq(cinemaEpisodes.id, cinemaWatchProgress.episodeId),
    )
    .where(
      and(
        eq(cinemaWatchProgress.userId, options.userId),
        or(
          eq(cinemaWatchProgress.finished, true),
          sql`${cinemaWatchProgress.positionMs} > 0`,
        ),
      ),
    )
    .orderBy(desc(cinemaWatchProgress.updatedAt), desc(cinemaWatchProgress.id))

  if (activityRows.length === 0) {
    return []
  }

  // Group qualifying activity rows per series, keeping series ordered by latest activity.
  const activityBySeries = new Map<string, typeof activityRows>()
  for (const row of activityRows) {
    const list = activityBySeries.get(row.seriesId)
    if (list) {
      list.push(row)
    } else {
      activityBySeries.set(row.seriesId, [row])
    }
  }

  const seriesIds = [...activityBySeries.keys()]
  const episodeFiles = playableEpisodeFiles(db)
  const playableRows = await db
    .select({
      seriesTitle: cinemaSeries.title,
      seriesPosterObjectId: seriesPosterClaim.objectId,
      seriesBackdropObjectId: seriesBackdropClaim.objectId,
      id: cinemaEpisodes.id,
      seriesId: cinemaEpisodes.seriesId,
      tmdbId: cinemaEpisodes.tmdbId,
      seasonNumber: cinemaEpisodes.seasonNumber,
      episodeNumber: cinemaEpisodes.episodeNumber,
      title: cinemaEpisodes.title,
      overview: cinemaEpisodes.overview,
      runtimeMinutes: cinemaEpisodes.runtimeMinutes,
      stillObjectId: stillClaim.objectId,
      airDate: cinemaEpisodes.airDate,
      addedAt: episodeFiles.addedAt,
      progressPositionMs: cinemaWatchProgress.positionMs,
      progressDurationMs: cinemaWatchProgress.durationMs,
      progressFinished: cinemaWatchProgress.finished,
      progressWatchCount: cinemaWatchProgress.watchCount,
      progressUpdatedAt: cinemaWatchProgress.updatedAt,
    })
    .from(cinemaEpisodes)
    .innerJoin(cinemaSeries, eq(cinemaSeries.id, cinemaEpisodes.seriesId))
    .innerJoin(episodeFiles, eq(episodeFiles.episodeId, cinemaEpisodes.id))
    .leftJoin(
      cinemaWatchProgress,
      and(
        eq(cinemaWatchProgress.episodeId, cinemaEpisodes.id),
        eq(cinemaWatchProgress.userId, options.userId),
      ),
    )
    .leftJoin(
      stillClaim,
      and(
        eq(stillClaim.objectId, cinemaEpisodes.stillObjectId),
        isNull(stillClaim.releasedAt),
      ),
    )
    .leftJoin(
      seriesPosterClaim,
      and(
        eq(seriesPosterClaim.objectId, cinemaSeries.posterObjectId),
        isNull(seriesPosterClaim.releasedAt),
      ),
    )
    .leftJoin(
      seriesBackdropClaim,
      and(
        eq(seriesBackdropClaim.objectId, cinemaSeries.backdropObjectId),
        isNull(seriesBackdropClaim.releasedAt),
      ),
    )
    .where(inArray(cinemaEpisodes.seriesId, seriesIds))
    .orderBy(
      asc(cinemaEpisodes.seasonNumber),
      asc(cinemaEpisodes.episodeNumber),
    )

  const seriesPlayable = new Map<
    string,
    {
      seriesTitle: string
      seriesPosterObjectId: string | null
      seriesBackdropObjectId: string | null
      episodes: PlayableEpisode[]
      byId: Map<string, PlayableEpisode>
    }
  >()

  for (const row of playableRows) {
    const ep = toPlayableEpisode(row)
    let entry = seriesPlayable.get(row.seriesId)
    if (!entry) {
      entry = {
        seriesTitle: row.seriesTitle,
        seriesPosterObjectId: row.seriesPosterObjectId,
        seriesBackdropObjectId: row.seriesBackdropObjectId,
        episodes: [],
        byId: new Map(),
      }
      seriesPlayable.set(row.seriesId, entry)
    }
    entry.episodes.push(ep)
    entry.byId.set(ep.id, ep)
  }

  const results: ContinueWatchingEpisodeRow[] = []
  for (const [seriesId, rows] of activityBySeries) {
    const playable = seriesPlayable.get(seriesId)
    if (!playable) {
      continue
    }

    for (const row of rows) {
      if (!row.finished && row.positionMs > 0n) {
        const ep = playable.byId.get(row.episodeId)
        if (!ep || !ep.progress) {
          // Episode file was removed; check older activity in this series.
          continue
        }
        results.push({
          seriesId,
          seriesTitle: playable.seriesTitle,
          seriesPosterObjectId: playable.seriesPosterObjectId,
          seriesBackdropObjectId: playable.seriesBackdropObjectId,
          episode: ep,
          progress: ep.progress,
          activityAt: row.updatedAt,
        })
        break
      }

      if (row.finished) {
        const next = playable.episodes.find(
          (ep) =>
            isAfterEpisode(ep, row.seasonNumber, row.episodeNumber) &&
            !ep.progress?.finished,
        )
        if (next) {
          const nextProgress =
            next.progress && next.progress.positionMs > 0n
              ? next.progress
              : null
          results.push({
            seriesId,
            seriesTitle: playable.seriesTitle,
            seriesPosterObjectId: playable.seriesPosterObjectId,
            seriesBackdropObjectId: playable.seriesBackdropObjectId,
            episode: next,
            progress: nextProgress,
            activityAt: row.updatedAt,
          })
        }
        // Finished the latest episode with nothing unwatched after it; series is done.
        break
      }
    }
  }

  results.sort((a, b) => {
    const diff = b.activityAt.getTime() - a.activityAt.getTime()
    return diff !== 0 ? diff : b.episode.id.localeCompare(a.episode.id)
  })
  return results.slice(0, options.limit)
}
