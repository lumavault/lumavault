import type { cinemaWatchProgress } from '#/db/schemas/cinema.js'

/** One person's playback state for a single movie or episode. */
export type WatchProgressRow = typeof cinemaWatchProgress.$inferSelect

/** Identifies either a movie or an episode in cinema.watch_progress. */
export type WatchProgressTarget =
  { kind: 'movie'; id: string } | { kind: 'episode'; id: string }

/** Values written when a client reports playback progress. */
export interface UpsertWatchProgressInput {
  userId: string
  target: WatchProgressTarget
  positionMs: bigint
  durationMs: bigint
  finished: boolean
  now: Date
}

/** Values written when a user manually marks a title watched or unwatched. */
export interface SetWatchedInput {
  userId: string
  target: WatchProgressTarget
  watched: boolean
  now: Date
}
