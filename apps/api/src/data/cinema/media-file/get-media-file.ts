import {
  keysetAfterTz,
  keysetOrder,
  uuid,
  type PageCursor,
} from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaMovies,
  cinemaSeries,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import { and, eq, isNotNull, isNull, or, type SQL } from 'drizzle-orm'

import type { MediaFileDetails, MediaFileFilterMode } from './types.js'

const mediaFileSelection = {
  id: cinemaMediaFiles.id,
  objectId: cinemaMediaFiles.objectId,
  filename: cinemaMediaFiles.filename,
  sizeBytes: iamObjectClaims.bytes,
  kind: cinemaMediaFiles.kind,
  container: cinemaMediaFiles.container,
  addedAt: cinemaMediaFiles.addedAt,
  movieId: cinemaMovies.id,
  movieTmdbId: cinemaMovies.tmdbId,
  movieTitle: cinemaMovies.title,
  movieReleaseYear: cinemaMovies.releaseYear,
  episodeId: cinemaEpisodes.id,
  episodeSeriesId: cinemaEpisodes.seriesId,
  episodeSeasonNumber: cinemaEpisodes.seasonNumber,
  episodeNumber: cinemaEpisodes.episodeNumber,
  episodeTitle: cinemaEpisodes.title,
  seriesTmdbId: cinemaSeries.tmdbId,
  seriesTitle: cinemaSeries.title,
}

function selectMediaFiles(db: DbOrTx) {
  return db
    .select(mediaFileSelection)
    .from(cinemaMediaFiles)
    .innerJoin(
      iamObjectClaims,
      eq(iamObjectClaims.objectId, cinemaMediaFiles.objectId),
    )
    .leftJoin(cinemaMovies, eq(cinemaMovies.id, cinemaMediaFiles.movieId))
    .leftJoin(cinemaEpisodes, eq(cinemaEpisodes.id, cinemaMediaFiles.episodeId))
    .leftJoin(cinemaSeries, eq(cinemaSeries.id, cinemaEpisodes.seriesId))
}

type SelectedMediaFileRow = Awaited<ReturnType<typeof selectMediaFiles>>[number]

function toDetails(row: SelectedMediaFileRow): MediaFileDetails {
  const movie =
    row.movieId !== null && row.movieTmdbId !== null && row.movieTitle !== null
      ? {
          movieId: row.movieId,
          tmdbId: row.movieTmdbId,
          title: row.movieTitle,
          releaseYear: row.movieReleaseYear,
        }
      : null
  const episode =
    row.episodeId !== null &&
    row.episodeSeriesId !== null &&
    row.seriesTmdbId !== null &&
    row.seriesTitle !== null &&
    row.episodeSeasonNumber !== null &&
    row.episodeNumber !== null &&
    row.episodeTitle !== null
      ? {
          seriesId: row.episodeSeriesId,
          episodeId: row.episodeId,
          tmdbSeriesId: row.seriesTmdbId,
          seriesTitle: row.seriesTitle,
          seasonNumber: row.episodeSeasonNumber,
          episodeNumber: row.episodeNumber,
          episodeTitle: row.episodeTitle,
        }
      : null
  return {
    id: row.id,
    objectId: row.objectId,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    kind: row.kind,
    container: row.container,
    addedAt: row.addedAt,
    movie,
    episode,
  }
}

function filterCondition(filter: MediaFileFilterMode): SQL | undefined {
  switch (filter) {
    case 'all':
      return undefined
    case 'unmatched':
      return and(
        isNull(cinemaMediaFiles.movieId),
        isNull(cinemaMediaFiles.episodeId),
      )
    case 'matched':
      return or(
        isNotNull(cinemaMediaFiles.movieId),
        isNotNull(cinemaMediaFiles.episodeId),
      )
  }
}

/** A media file by ID with size and match details. Null when missing or the ID is not a UUID. */
export async function getMediaFileById(
  db: DbOrTx,
  mediaFileId: string,
): Promise<MediaFileDetails | null> {
  const [row] = await selectMediaFiles(db)
    .where(eq(cinemaMediaFiles.id, uuid(mediaFileId)))
    .catch(noRowsOnBadUuid)
  return row ? toDetails(row) : null
}

/** A media file by its Storage Gateway object ID, with size and match details. */
export async function getMediaFileByObjectId(
  db: DbOrTx,
  objectId: string,
): Promise<MediaFileDetails | null> {
  const [row] = await selectMediaFiles(db).where(
    eq(cinemaMediaFiles.objectId, objectId),
  )
  return row ? toDetails(row) : null
}

/** A page of library media files ordered by added_at then ID, optionally filtered by match status. */
export async function getMediaFilePage(
  db: DbOrTx,
  page: {
    filter: MediaFileFilterMode
    after?: PageCursor
    limit: number
  },
): Promise<MediaFileDetails[]> {
  const rows = await selectMediaFiles(db)
    .where(
      and(
        filterCondition(page.filter),
        page.after
          ? keysetAfterTz(
              cinemaMediaFiles.addedAt,
              cinemaMediaFiles.id,
              page.after,
            )
          : undefined,
      ),
    )
    .orderBy(...keysetOrder(cinemaMediaFiles.addedAt, cinemaMediaFiles.id))
    .limit(page.limit)
  return rows.map(toDetails)
}
