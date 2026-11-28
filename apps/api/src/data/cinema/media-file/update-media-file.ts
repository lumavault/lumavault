import { uuid } from '#/data/sql.js'
import { noRowsOnBadUuid } from '#/db/errors.js'
import type { DbOrTx } from '#/db/index.js'
import { cinemaMediaFiles } from '#/db/schemas/cinema.js'
import { and, eq, ne } from 'drizzle-orm'

import type { LinkMediaFileResult, MediaFileMatchTarget } from './types.js'

export interface LinkMediaFileInput {
  mediaFileId: string
  target: MediaFileMatchTarget
  /** When true, removes any other original file on the target and returns its objectId for release. */
  replaceExisting: boolean
  /** When true, leaves already-matched files untouched so background work never clobbers manual matches. */
  onlyIfUnmatched?: boolean
}

/**
 * Links a media file to a movie or episode, enforcing one original file per target.
 * Call inside a transaction that has already upserted and locked the target catalog row.
 */
export async function linkMediaFileToTarget(
  db: DbOrTx,
  input: LinkMediaFileInput,
): Promise<LinkMediaFileResult> {
  const [current] = await db
    .select()
    .from(cinemaMediaFiles)
    .where(eq(cinemaMediaFiles.id, uuid(input.mediaFileId)))
    .for('update')
    .catch(noRowsOnBadUuid)
  if (!current) {
    return { status: 'not_found' }
  }

  if (
    input.onlyIfUnmatched &&
    (current.movieId !== null || current.episodeId !== null)
  ) {
    return { status: 'already_matched' }
  }

  const sameTarget =
    input.target.kind === 'movie'
      ? current.movieId === input.target.movieId && current.episodeId === null
      : current.episodeId === input.target.episodeId && current.movieId === null
  if (sameTarget) {
    return { status: 'linked', file: current, replacedObjectId: null }
  }

  const targetColumn =
    input.target.kind === 'movie'
      ? cinemaMediaFiles.movieId
      : cinemaMediaFiles.episodeId
  const targetId =
    input.target.kind === 'movie'
      ? input.target.movieId
      : input.target.episodeId

  let replacedObjectId: string | null = null
  if (current.kind === 'original') {
    const [existing] = await db
      .select()
      .from(cinemaMediaFiles)
      .where(
        and(
          eq(targetColumn, uuid(targetId)),
          eq(cinemaMediaFiles.kind, 'original'),
          ne(cinemaMediaFiles.id, current.id),
        ),
      )
      .for('update')
    if (existing) {
      if (!input.replaceExisting) {
        return { status: 'target_occupied' }
      }
      // Remove the old original first so the partial unique index accepts the new link.
      await db
        .delete(cinemaMediaFiles)
        .where(eq(cinemaMediaFiles.id, existing.id))
      replacedObjectId = existing.objectId
    }
  }

  const [updated] = await db
    .update(cinemaMediaFiles)
    .set(
      input.target.kind === 'movie'
        ? { movieId: input.target.movieId, episodeId: null }
        : { movieId: null, episodeId: input.target.episodeId },
    )
    .where(eq(cinemaMediaFiles.id, current.id))
    .returning()

  return {
    status: 'linked',
    file: updated!,
    replacedObjectId,
  }
}
