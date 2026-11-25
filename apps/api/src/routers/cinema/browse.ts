import type { MessageInitShape } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { LumaVaultClient } from '@lumavault/sdk'
import {
  CinemaService,
  type CatalogItemSchema,
  type ContinueWatchingItemSchema,
  type EpisodeSchema,
  type MovieSchema,
  type SeasonSchema,
  type SeriesSchema,
  type SeriesSummarySchema,
  type WatchProgressSchema,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { signReadTicket } from '#/auth/tickets.js'
import {
  getContinueWatchingEpisodes,
  getPlayableEpisodesBySeriesId,
} from '#/data/cinema/episode/get-episode.js'
import type {
  EpisodeWatchProgress,
  PlayableEpisode,
} from '#/data/cinema/episode/types.js'
import {
  getContinueWatchingMovies,
  getPlayableMovieById,
  getPlayableMoviesPage,
  getRecentlyAddedMovies,
} from '#/data/cinema/movie/get-movie.js'
import type {
  MovieWatchProgress,
  PlayableMovie,
} from '#/data/cinema/movie/types.js'
import {
  getPlayableSeriesById,
  getPlayableSeriesPage,
  getRecentlyAddedSeries,
} from '#/data/cinema/series/get-series.js'
import type { PlayableSeriesSummary } from '#/data/cinema/series/types.js'
import type { PageCursor } from '#/data/sql.js'
import { requireApp } from '#/guards.js'
import { paged } from '#/lib/paging.js'
import { uuidSchema } from '#/lib/validation.js'
import type { ApiModule, ModuleContext } from '#/server/modules.js'

const HOME_HERO_LIMIT = 5
const HOME_ROW_LIMIT = 20

type ArtUrlSigner = (objectId: string | null) => string

function createArtUrlSigner(ctx: Pick<ModuleContext, 'config'>): ArtUrlSigner {
  const sdk = new LumaVaultClient({ baseUrl: ctx.config.gatewayUrl })
  return (objectId) => {
    if (!objectId) {
      return ''
    }
    const { ticket } = signReadTicket(ctx.config.ticketSecret, { objectId })
    return sdk.streamUrl(objectId, ticket)
  }
}

function progressToWire(
  progress: MovieWatchProgress | EpisodeWatchProgress,
): MessageInitShape<typeof WatchProgressSchema> {
  return {
    positionMs: progress.positionMs,
    durationMs: progress.durationMs,
    finished: progress.finished,
    watchCount: progress.watchCount,
    updatedAt: timestampFromDate(progress.updatedAt),
  }
}

function movieToWire(
  movie: PlayableMovie,
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof MovieSchema> {
  return {
    id: movie.id,
    tmdbId: movie.tmdbId,
    title: movie.title,
    overview: movie.overview,
    releaseYear: movie.releaseYear ?? 0,
    runtimeMinutes: movie.runtimeMinutes ?? 0,
    posterUrl: artUrl(movie.posterObjectId),
    backdropUrl: artUrl(movie.backdropObjectId),
    progress: movie.progress ? progressToWire(movie.progress) : undefined,
    addedAt: timestampFromDate(movie.addedAt),
  }
}

function seriesBaseFields(series: PlayableSeriesSummary, artUrl: ArtUrlSigner) {
  return {
    id: series.id,
    tmdbId: series.tmdbId,
    title: series.title,
    overview: series.overview,
    firstAirYear: series.firstAirYear ?? 0,
    posterUrl: artUrl(series.posterObjectId),
    backdropUrl: artUrl(series.backdropObjectId),
    watchedEpisodeCount: series.watchedEpisodeCount,
    totalEpisodeCount: series.totalEpisodeCount,
    addedAt: timestampFromDate(series.addedAt),
  }
}

function seriesSummaryToWire(
  series: PlayableSeriesSummary,
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof SeriesSummarySchema> {
  return seriesBaseFields(series, artUrl)
}

function seriesToWire(
  series: PlayableSeriesSummary,
  episodes: PlayableEpisode[],
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof SeriesSchema> {
  return {
    ...seriesBaseFields(series, artUrl),
    seasons: groupSeasons(episodes, artUrl),
  }
}

function episodeToWire(
  episode: PlayableEpisode,
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof EpisodeSchema> {
  return {
    id: episode.id,
    tmdbId: episode.tmdbId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    overview: episode.overview,
    runtimeMinutes: episode.runtimeMinutes ?? 0,
    stillUrl: artUrl(episode.stillObjectId),
    airDate: episode.airDate ?? '',
    progress: episode.progress ? progressToWire(episode.progress) : undefined,
    addedAt: timestampFromDate(episode.addedAt),
  }
}

function groupSeasons(
  episodes: PlayableEpisode[],
  artUrl: ArtUrlSigner,
): MessageInitShape<typeof SeasonSchema>[] {
  const seasons: {
    seasonNumber: number
    episodes: MessageInitShape<typeof EpisodeSchema>[]
  }[] = []
  for (const ep of episodes) {
    const last = seasons[seasons.length - 1]
    if (last && last.seasonNumber === ep.seasonNumber) {
      last.episodes.push(episodeToWire(ep, artUrl))
    } else {
      seasons.push({
        seasonNumber: ep.seasonNumber,
        episodes: [episodeToWire(ep, artUrl)],
      })
    }
  }
  return seasons
}

function requireId(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new ConnectError(`${field} is required`, Code.InvalidArgument)
  }
  return trimmed
}

function assertUuidCursor(after: PageCursor | undefined): void {
  if (after && !uuidSchema.safeParse(after.id).success) {
    throw new ConnectError('page_token is not valid', Code.InvalidArgument)
  }
}

function requireCinemaAccess(
  call: Parameters<typeof requireApp>[0],
  ctx: ModuleContext,
) {
  return requireApp(call, ctx, 'cinema', {
    allowSuperAdminWithoutHousehold: true,
  })
}

export const module: ApiModule = {
  name: 'cinema-browse',
  rpc(router, ctx) {
    const artUrl = createArtUrlSigner(ctx)

    router.rpc(CinemaService.method.getHome, async (_req, call) => {
      const { viewer } = await requireCinemaAccess(call, ctx)
      const [recentMovies, recentSeries, continueMovies, continueEpisodes] =
        await Promise.all([
          getRecentlyAddedMovies(ctx.db, {
            userId: viewer.userId,
            limit: HOME_ROW_LIMIT,
          }),
          getRecentlyAddedSeries(ctx.db, {
            userId: viewer.userId,
            limit: HOME_ROW_LIMIT,
          }),
          getContinueWatchingMovies(ctx.db, {
            userId: viewer.userId,
            limit: HOME_ROW_LIMIT,
          }),
          getContinueWatchingEpisodes(ctx.db, {
            userId: viewer.userId,
            limit: HOME_ROW_LIMIT,
          }),
        ])

      const mergedRecent: {
        addedAt: Date
        id: string
        item: MessageInitShape<typeof CatalogItemSchema>
      }[] = [
        ...recentMovies.map((m) => ({
          addedAt: m.addedAt,
          id: m.id,
          item: {
            item: { case: 'movie' as const, value: movieToWire(m, artUrl) },
          },
        })),
        ...recentSeries.map((s) => ({
          addedAt: s.addedAt,
          id: s.id,
          item: {
            item: {
              case: 'series' as const,
              value: seriesSummaryToWire(s, artUrl),
            },
          },
        })),
      ]
      mergedRecent.sort((a, b) => {
        const diff = b.addedAt.getTime() - a.addedAt.getTime()
        return diff !== 0 ? diff : b.id.localeCompare(a.id)
      })
      const recentlyAdded = mergedRecent
        .slice(0, HOME_ROW_LIMIT)
        .map((entry) => entry.item)

      const mergedContinue: {
        activityAt: Date
        id: string
        item: MessageInitShape<typeof ContinueWatchingItemSchema>
      }[] = [
        ...continueMovies.map((m) => ({
          activityAt: m.progress.updatedAt,
          id: m.movie.id,
          item: {
            item: {
              case: 'movie' as const,
              value: movieToWire(m.movie, artUrl),
            },
            progress: progressToWire(m.progress),
          },
        })),
        ...continueEpisodes.map((e) => ({
          activityAt: e.activityAt,
          id: e.episode.id,
          item: {
            item: {
              case: 'episode' as const,
              value: {
                seriesId: e.seriesId,
                seriesTitle: e.seriesTitle,
                seriesPosterUrl: artUrl(e.seriesPosterObjectId),
                seriesBackdropUrl: artUrl(e.seriesBackdropObjectId),
                episode: episodeToWire(e.episode, artUrl),
              },
            },
            progress: e.progress ? progressToWire(e.progress) : undefined,
          },
        })),
      ]
      mergedContinue.sort((a, b) => {
        const diff = b.activityAt.getTime() - a.activityAt.getTime()
        return diff !== 0 ? diff : b.id.localeCompare(a.id)
      })
      const continueWatching = mergedContinue
        .slice(0, HOME_ROW_LIMIT)
        .map((entry) => entry.item)

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
      const movieId = requireId(req.movieId, 'movie_id')
      const movie = await getPlayableMovieById(ctx.db, movieId, viewer.userId)
      if (!movie) {
        throw new ConnectError('movie not found', Code.NotFound)
      }
      return { movie: movieToWire(movie, artUrl) }
    })

    router.rpc(CinemaService.method.getSeries, async (req, call) => {
      const { viewer } = await requireCinemaAccess(call, ctx)
      const seriesId = requireId(req.seriesId, 'series_id')
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
      return {
        series: seriesToWire(series, episodes, artUrl),
      }
    })
  },
}
