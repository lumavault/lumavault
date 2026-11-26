/** Series identity and active art object IDs, used when attaching series info to episodes. */
export interface SeriesHeader {
  id: string
  title: string
  posterObjectId: string | null
  backdropObjectId: string | null
}

/** A series with at least one playable episode, with active art and the caller's episode counts. */
export interface PlayableSeriesSummary extends SeriesHeader {
  tmdbId: number
  overview: string
  firstAirYear: number | null
  watchedEpisodeCount: number
  totalEpisodeCount: number
  createdAt: Date
  addedAt: Date
}
