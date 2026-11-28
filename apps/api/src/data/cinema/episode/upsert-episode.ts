import type { DbOrTx } from '#/db/index.js'
import { cinemaEpisodes } from '#/db/schemas/cinema.js'

import type { EpisodeRow, UpsertEpisodeInput } from './types.js'

/** Inserts an episode by TMDB ID or refreshes its catalog metadata and internal still path. */
export async function upsertEpisode(
  db: DbOrTx,
  input: UpsertEpisodeInput,
): Promise<EpisodeRow> {
  const [row] = await db
    .insert(cinemaEpisodes)
    .values({
      seriesId: input.seriesId,
      tmdbId: input.tmdbId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      title: input.title,
      overview: input.overview,
      runtimeMinutes: input.runtimeMinutes,
      airDate: input.airDate,
      stillPath: input.stillPath,
    })
    .onConflictDoUpdate({
      target: cinemaEpisodes.tmdbId,
      set: {
        seriesId: input.seriesId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
        title: input.title,
        overview: input.overview,
        runtimeMinutes: input.runtimeMinutes,
        airDate: input.airDate,
        stillPath: input.stillPath,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row!
}
