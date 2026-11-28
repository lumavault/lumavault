import type { DbOrTx } from '#/db/index.js'
import { cinemaSeries } from '#/db/schemas/cinema.js'

import type { SeriesRow, UpsertSeriesInput } from './types.js'

/** Inserts a TV series by TMDB ID or refreshes its catalog metadata and internal art paths. */
export async function upsertSeries(
  db: DbOrTx,
  input: UpsertSeriesInput,
): Promise<SeriesRow> {
  const [row] = await db
    .insert(cinemaSeries)
    .values({
      tmdbId: input.tmdbId,
      title: input.title,
      overview: input.overview,
      firstAirYear: input.firstAirYear,
      posterPath: input.posterPath,
      backdropPath: input.backdropPath,
    })
    .onConflictDoUpdate({
      target: cinemaSeries.tmdbId,
      set: {
        title: input.title,
        overview: input.overview,
        firstAirYear: input.firstAirYear,
        posterPath: input.posterPath,
        backdropPath: input.backdropPath,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row!
}
