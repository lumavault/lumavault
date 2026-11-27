import { Code, ConnectError } from '@connectrpc/connect'
import { CinemaService } from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import {
  getContinueWatchingEpisodes,
  getPlayableEpisodesBySeriesId,
} from '#/data/cinema/episode/get-episode.js'
import {
  getContinueWatchingMovies,
  getPlayableMovieById,
  getPlayableMoviesPage,
  getRecentlyAddedMovies,
} from '#/data/cinema/movie/get-movie.js'
import {
  getPlayableSeriesById,
  getPlayableSeriesPage,
  getRecentlyAddedSeries,
} from '#/data/cinema/series/get-series.js'
import { paged } from '#/lib/paging.js'
import { requireUuid } from '#/lib/validation.js'
import type { ApiModule } from '#/server/modules.js'

import { HOME_HERO_LIMIT, HOME_ROW_LIMIT } from './constants.js'
import {
  assertUuidCursor,
  catalogItemToWire,
  continueWatchingItemToWire,
  createArtUrlSigner,
  movieToWire,
  requireCinemaAccess,
  seriesSummaryToWire,
  seriesToWire,
} from './convert.js'

function mergeLatest<T>(
  entries: { sortAt: Date; id: string; value: T }[],
  limit: number,
): T[] {
  return entries
    .sort((a, b) => {
      const diff = b.sortAt.getTime() - a.sortAt.getTime()
      return diff !== 0 ? diff : b.id.localeCompare(a.id)
    })
    .slice(0, limit)
    .map((entry) => entry.value)
}

export const module: ApiModule = {
  name: 'cinema-browse',
  rpc(router, ctx) {
    const artUrl = createArtUrlSigner(ctx)

    router.rpc(CinemaService.method.getHome, async (_req, call) => {
      const { viewer } = await requireCinemaAccess(call, ctx)
      const rowOptions = { userId: viewer.userId, limit: HOME_ROW_LIMIT }
      const [recentMovies, recentSeries, continueMovies, continueEpisodes] =
        await Promise.all([
          getRecentlyAddedMovies(ctx.db, rowOptions),
          getRecentlyAddedSeries(ctx.db, rowOptions),
          getContinueWatchingMovies(ctx.db, rowOptions),
          getContinueWatchingEpisodes(ctx.db, rowOptions),
        ])

      const recentlyAdded = mergeLatest(
        [
          ...recentMovies.map((movie) => ({
            sortAt: movie.addedAt,
            id: movie.id,
            value: catalogItemToWire({ kind: 'movie', movie }, artUrl),
          })),
          ...recentSeries.map((series) => ({
            sortAt: series.addedAt,
            id: series.id,
            value: catalogItemToWire({ kind: 'series', series }, artUrl),
          })),
        ],
        HOME_ROW_LIMIT,
      )

      const continueWatching = mergeLatest(
        [
          ...continueMovies.map((item) => ({
            sortAt: item.progress.updatedAt,
            id: item.movie.id,
            value: continueWatchingItemToWire({ kind: 'movie', item }, artUrl),
          })),
          ...continueEpisodes.map((item) => ({
            sortAt: item.activityAt,
            id: item.episode.id,
            value: continueWatchingItemToWire(
              { kind: 'episode', item },
              artUrl,
            ),
          })),
        ],
        HOME_ROW_LIMIT,
      )

      return {
        heroes: recentlyAdded.slice(0, HOME_HERO_LIMIT),
        continueWatching,
        recentlyAdded,
        movies: recentMovies.map((m) => movieToWire(m, artUrl)),
        series: recentSeries.map((s) => seriesSummaryToWire(s, artUrl)),
      }
    })

    router.rpc(CinemaService.method.listMovies, async (req, call) => {
      const { viewer } = await requireCinemaAccess(call, ctx)
      const query = req.query.trim() || undefined
      const { rows, nextPageToken } = await paged(
        req,
        (after, limit) => {
          assertUuidCursor(after)
          return getPlayableMoviesPage(ctx.db, {
            userId: viewer.userId,
            query,
            after,
            limit,
          })
        },
        (m) => ({ createdAt: m.createdAt, id: m.id }),
      )
      return {
        movies: rows.map((m) => movieToWire(m, artUrl)),
        nextPageToken,
      }
    })

    router.rpc(CinemaService.method.listSeries, async (req, call) => {
      const { viewer } = await requireCinemaAccess(call, ctx)
      const query = req.query.trim() || undefined
      const { rows, nextPageToken } = await paged(
        req,
        (after, limit) => {
          assertUuidCursor(after)
          return getPlayableSeriesPage(ctx.db, {
            userId: viewer.userId,
            query,
            after,
            limit,
          })
        },
        (s) => ({ createdAt: s.createdAt, id: s.id }),
      )
      return {
        series: rows.map((s) => seriesSummaryToWire(s, artUrl)),
        nextPageToken,
      }
    })

    router.rpc(CinemaService.method.getMovie, async (req, call) => {
      const { viewer } = await requireCinemaAccess(call, ctx)
      const movieId = requireUuid(req.movieId, 'movie_id')
      const movie = await getPlayableMovieById(ctx.db, movieId, viewer.userId)
      if (!movie) {
        throw new ConnectError('movie not found', Code.NotFound)
      }
      return { movie: movieToWire(movie, artUrl) }
    })

    router.rpc(CinemaService.method.getSeries, async (req, call) => {
      const { viewer } = await requireCinemaAccess(call, ctx)
      const seriesId = requireUuid(req.seriesId, 'series_id')
      const series = await getPlayableSeriesById(
        ctx.db,
        seriesId,
        viewer.userId,
      )
      if (!series) {
        throw new ConnectError('series not found', Code.NotFound)
      }
      const episodes = await getPlayableEpisodesBySeriesId(
        ctx.db,
        series.id,
        viewer.userId,
      )
      if (episodes.length === 0) {
        throw new ConnectError('series not found', Code.NotFound)
      }
      return { series: seriesToWire(series, episodes, artUrl) }
    })
  },
}
