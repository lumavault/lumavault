import type { WatchProgressRow } from '#/data/cinema/watch-progress/types.js'
import type { cinemaMovies } from '#/db/schemas/cinema.js'

/** A movie row in cinema.movies. */
export type MovieRow = typeof cinemaMovies.$inferSelect

/** TMDB metadata fields written when creating or refreshing a movie row. */
export interface UpsertMovieInput {
  tmdbId: number
  title: string
  overview: string
  releaseYear: number | null
  runtimeMinutes: number | null
  posterPath: string | null
  backdropPath: string | null
}

/** A movie that has at least one playable media file, with active art and the caller's progress. */
export interface PlayableMovie {
  id: string
  tmdbId: number
  title: string
  overview: string
  releaseYear: number | null
  runtimeMinutes: number | null
  posterObjectId: string | null
  backdropObjectId: string | null
  createdAt: Date
  addedAt: Date
  progress: WatchProgressRow | null
}

/** A caller's in-progress playable movie for the Continue Watching row. */
export interface ContinueWatchingMovie {
  movie: PlayableMovie
  progress: WatchProgressRow
}
