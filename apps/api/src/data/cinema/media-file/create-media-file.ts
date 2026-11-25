import type { DbOrTx } from '#/db/index.js'
import { cinemaMediaFiles } from '#/db/schemas/cinema.js'

import type { MediaFileRow, NewMediaFile } from './types.js'

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
