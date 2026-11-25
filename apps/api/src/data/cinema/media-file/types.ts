import type { cinemaMediaFiles } from '#/db/schemas/cinema.js'

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

/** Movie summary attached to a matched media file. */
export interface MediaFileMovieMatch {
  movieId: string
  tmdbId: number
  title: string
  releaseYear: number | null
}

/** Episode summary attached to a matched media file. */
export interface MediaFileEpisodeMatch {
  seriesId: string
  episodeId: string
  tmdbSeriesId: number
  seriesTitle: string
  seasonNumber: number
  episodeNumber: number
  episodeTitle: string
}

/** A media file joined with its object claim size and optional movie or episode match. */
export interface MediaFileDetails {
  id: string
  objectId: string
  filename: string
  sizeBytes: bigint
  kind: MediaFileKindValue
  container: MediaContainerValue
  addedAt: Date
  movie: MediaFileMovieMatch | null
  episode: MediaFileEpisodeMatch | null
}
