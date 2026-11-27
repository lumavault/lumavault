import type { WatchProgressRow } from '#/data/cinema/watch-progress/types.js'

/** An episode with at least one playable media file, active still art, and the caller's progress. */
export interface PlayableEpisode {
  id: string
  seriesId: string
  tmdbId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  overview: string
  runtimeMinutes: number | null
  stillObjectId: string | null
  airDate: string | null
  addedAt: Date
  progress: WatchProgressRow | null
}

/** An in-progress or queued next-up episode for the caller's Continue Watching row. */
export interface ContinueWatchingEpisodeRow {
  seriesId: string
  seriesTitle: string
  seriesPosterObjectId: string | null
  seriesBackdropObjectId: string | null
  episode: PlayableEpisode
  /** Null when the entry is a queued next unwatched episode. */
  progress: WatchProgressRow | null
  /** Activity timestamp used to order Continue Watching across movies and series. */
  activityAt: Date
}
