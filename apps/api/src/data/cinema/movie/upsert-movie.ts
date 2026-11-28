import type { DbOrTx } from '#/db/index.js'
import { cinemaMovies } from '#/db/schemas/cinema.js'

import type { MovieRow, UpsertMovieInput } from './types.js'

/** Inserts a movie by TMDB ID or refreshes its catalog metadata and internal art paths. */
export async function upsertMovie(
  db: DbOrTx,
  input: UpsertMovieInput,
): Promise<MovieRow> {
  const [row] = await db
    .insert(cinemaMovies)
    .values({
      tmdbId: input.tmdbId,
      title: input.title,
      overview: input.overview,
      releaseYear: input.releaseYear,
      runtimeMinutes: input.runtimeMinutes,
      posterPath: input.posterPath,
      backdropPath: input.backdropPath,
    })
    .onConflictDoUpdate({
      target: cinemaMovies.tmdbId,
      set: {
        title: input.title,
        overview: input.overview,
        releaseYear: input.releaseYear,
        runtimeMinutes: input.runtimeMinutes,
        posterPath: input.posterPath,
        backdropPath: input.backdropPath,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row!
}
