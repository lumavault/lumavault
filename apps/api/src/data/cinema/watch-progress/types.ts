import type { cinemaWatchProgress } from '#/db/schemas/cinema.js'

/** One person's playback state for a single movie or episode. */
export type WatchProgressRow = typeof cinemaWatchProgress.$inferSelect
