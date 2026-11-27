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

function selectMediaFiles(db: DbOrTx) {
  return db
    .select({
      file: cinemaMediaFiles,
      sizeBytes: iamObjectClaims.bytes,
      movie: cinemaMovies,
      episode: cinemaEpisodes,
      series: cinemaSeries,
    })
    .from(cinemaMediaFiles)
    .innerJoin(
      iamObjectClaims,
      eq(iamObjectClaims.objectId, cinemaMediaFiles.objectId),
    )
    .leftJoin(cinemaMovies, eq(cinemaMovies.id, cinemaMediaFiles.movieId))
    .leftJoin(cinemaEpisodes, eq(cinemaEpisodes.id, cinemaMediaFiles.episodeId))
    .leftJoin(cinemaSeries, eq(cinemaSeries.id, cinemaEpisodes.seriesId))
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
  return row ?? null
}

/** A media file by its Storage Gateway object ID, with size and match details. */
export async function getMediaFileByObjectId(
  db: DbOrTx,
  objectId: string,
): Promise<MediaFileDetails | null> {
  const [row] = await selectMediaFiles(db).where(
    eq(cinemaMediaFiles.objectId, objectId),
  )
  return row ?? null
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
  return selectMediaFiles(db)
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
}
