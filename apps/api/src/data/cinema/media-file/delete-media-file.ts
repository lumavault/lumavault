import { uuid } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { cinemaMediaFiles } from '#/db/schemas/cinema.js'
import { eq } from 'drizzle-orm'

import type { MediaFileRow } from './types.js'

/** Deletes one media file row by ID and returns it, or null when missing or not a UUID. */
export async function deleteMediaFile(
  db: DbOrTx,
  mediaFileId: string,
): Promise<MediaFileRow | null> {
  const [row] = await db
    .delete(cinemaMediaFiles)
    .where(eq(cinemaMediaFiles.id, uuid(mediaFileId)))
    .returning()
    .catch(noRowsOnBadUuid)
  return row ?? null
}
