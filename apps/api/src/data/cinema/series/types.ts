/** A series with at least one playable episode, with active art and the caller's episode counts. */
export interface PlayableSeriesSummary {
  id: string
  tmdbId: number
  title: string
  overview: string
  firstAirYear: number | null
  posterObjectId: string | null
  backdropObjectId: string | null
  watchedEpisodeCount: number
  totalEpisodeCount: number
  createdAt: Date
  addedAt: Date
}
