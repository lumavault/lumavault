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

/** Identifies either a movie or an episode target for a media file lookup. */
export type MediaFileTarget =
  { kind: 'movie'; id: string } | { kind: 'episode'; id: string }

/** An active original media file paired with its claimed byte size from iam.object_claims. */
export interface PlayableOriginalFile {
  file: MediaFileRow
  sizeBytes: bigint
}

/** Result of looking up a movie or episode and its active original media file. */
export type PlayableOriginalLookup =
  | { status: 'missing_target' }
  | { status: 'no_file' }
  | { status: 'ok'; source: PlayableOriginalFile }
