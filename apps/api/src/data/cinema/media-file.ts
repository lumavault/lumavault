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

/** A media file row in cinema.media_files. */
export type MediaFileRow = typeof cinemaMediaFiles.$inferSelect

export type MediaFileKindValue = MediaFileRow['kind']
export type MediaContainerValue = MediaFileRow['container']

/** What it takes to record a newly uploaded original media file. */
export type NewMediaFile = Pick<
  typeof cinemaMediaFiles.$inferInsert,
  'objectId' | 'filename' | 'container'
>

/** Match filter for listing library media files. */
export type MediaFileFilterMode = 'all' | 'unmatched' | 'matched'

/** A media file joined with its object claim size and optional movie or episode match. */
export interface MediaFileDetails {
  file: MediaFileRow
  sizeBytes: bigint
  movie: typeof cinemaMovies.$inferSelect | null
  episode: typeof cinemaEpisodes.$inferSelect | null
  series: typeof cinemaSeries.$inferSelect | null
}

/** Records a new unmatched original media file. Fails with a unique violation if objectId is already recorded. */
export async function createMediaFile(
  db: DbOrTx,
  input: NewMediaFile,
): Promise<MediaFileRow> {
  const [row] = await db
    .insert(cinemaMediaFiles)
    .values({
      objectId: input.objectId,
      filename: input.filename,
      container: input.container,
      kind: 'original',
    })
    .returning()
  return row!
}

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
