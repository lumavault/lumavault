import { getSeriesHeadersByIds } from '#/data/cinema/series/get-series.js'
import type { WatchProgressRow } from '#/data/cinema/watch-progress/types.js'
import { activeClaimOn, asDate, big, uuid } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { ContinueWatchingEpisodeRow, PlayableEpisode } from './types.js'

const stillClaim = alias(iamObjectClaims, 'episode_still_claim')

interface EpisodeActivity {
  episodeId: string
  seriesId: string
  seasonNumber: number
  episodeNumber: number
  positionMs: bigint
  finished: boolean
  updatedAt: Date
}

function toPlayableEpisode(row: {
  episode: typeof cinemaEpisodes.$inferSelect
  stillObjectId: string | null
  addedAt: Date | string
  progress: WatchProgressRow | null
}): PlayableEpisode {
  return {
    id: row.episode.id,
    seriesId: row.episode.seriesId,
    tmdbId: row.episode.tmdbId,
    seasonNumber: row.episode.seasonNumber,
    episodeNumber: row.episode.episodeNumber,
    title: row.episode.title,
    overview: row.episode.overview,
    runtimeMinutes: row.episode.runtimeMinutes,
    stillObjectId: row.stillObjectId,
    airDate: row.episode.airDate,
    addedAt: asDate(row.addedAt),
    progress: row.progress,
  }
}

function selectPlayableEpisodes(db: DbOrTx, userId: string) {
  const episodeFiles = db
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

  return db
    .select({
      episode: cinemaEpisodes,
      stillObjectId: stillClaim.objectId,
      addedAt: episodeFiles.addedAt,
      progress: cinemaWatchProgress,
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
      activeClaimOn(stillClaim, cinemaEpisodes.stillObjectId),
    )
}

/** All playable episodes of one series ordered by season and episode number ascending. */
export async function getPlayableEpisodesBySeriesId(
  db: DbOrTx,
  seriesId: string,
  userId: string,
): Promise<PlayableEpisode[]> {
  const rows = await selectPlayableEpisodes(db, userId)
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

// Picks the single Continue Watching episode for one series from activity ordered newest first.
function pickContinueEpisode(
  activity: EpisodeActivity[],
  episodes: PlayableEpisode[],
): {
  episode: PlayableEpisode
  progress: WatchProgressRow | null
  activityAt: Date
} | null {
  const byId = new Map(episodes.map((ep) => [ep.id, ep]))
  for (const row of activity) {
    if (!row.finished && row.positionMs > 0n) {
      const ep = byId.get(row.episodeId)
      if (ep?.progress) {
        return { episode: ep, progress: ep.progress, activityAt: row.updatedAt }
      }
      // Episode file was removed; fall back to older activity in this series.
      continue
    }
    if (row.finished) {
      const next = episodes.find(
        (ep) =>
          isAfterEpisode(ep, row.seasonNumber, row.episodeNumber) &&
          !ep.progress?.finished,
      )
      if (!next) {
        return null
      }
      const nextProgress =
        next.progress && next.progress.positionMs > 0n ? next.progress : null
      return {
        episode: next,
        progress: nextProgress,
        activityAt: row.updatedAt,
      }
    }
  }
  return null
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
          gt(cinemaWatchProgress.positionMs, big(0n)),
        ),
      ),
    )
    .orderBy(desc(cinemaWatchProgress.updatedAt), desc(cinemaWatchProgress.id))

  if (activityRows.length === 0) {
    return []
  }

  const activityBySeries = new Map<string, EpisodeActivity[]>()
  for (const row of activityRows) {
    const list = activityBySeries.get(row.seriesId) ?? []
    list.push(row)
    activityBySeries.set(row.seriesId, list)
  }

  const seriesIds = [...activityBySeries.keys()]
  const [playableRows, seriesHeaders] = await Promise.all([
    selectPlayableEpisodes(db, options.userId)
      .where(inArray(cinemaEpisodes.seriesId, seriesIds))
      .orderBy(
        asc(cinemaEpisodes.seasonNumber),
        asc(cinemaEpisodes.episodeNumber),
      ),
    getSeriesHeadersByIds(db, seriesIds),
  ])

  const episodesBySeries = new Map<string, PlayableEpisode[]>()
  for (const row of playableRows) {
    const ep = toPlayableEpisode(row)
    const list = episodesBySeries.get(ep.seriesId) ?? []
    list.push(ep)
    episodesBySeries.set(ep.seriesId, list)
  }

  const results: ContinueWatchingEpisodeRow[] = []
  for (const [seriesId, activity] of activityBySeries) {
    const header = seriesHeaders.get(seriesId)
    const episodes = episodesBySeries.get(seriesId)
    if (!header || !episodes) {
      continue
    }
    const picked = pickContinueEpisode(activity, episodes)
    if (picked) {
      results.push({
        seriesId,
        seriesTitle: header.title,
        seriesPosterObjectId: header.posterObjectId,
        seriesBackdropObjectId: header.backdropObjectId,
        ...picked,
      })
    }
  }

  results.sort((a, b) => {
    const diff = b.activityAt.getTime() - a.activityAt.getTime()
    return diff !== 0 ? diff : b.episode.id.localeCompare(a.episode.id)
  })
  return results.slice(0, options.limit)
}
