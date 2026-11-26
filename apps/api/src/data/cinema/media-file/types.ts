import type {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaMovies,
  cinemaSeries,
} from '#/db/schemas/cinema.js'

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
