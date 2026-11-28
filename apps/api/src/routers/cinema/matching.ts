import { Code, ConnectError } from '@connectrpc/connect'
import { CinemaService } from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { upsertEpisode } from '#/data/cinema/episode/upsert-episode.js'
import { getMediaFileById } from '#/data/cinema/media-file/get-media-file.js'
import type { MediaFileMatchTarget } from '#/data/cinema/media-file/types.js'
import { linkMediaFileToTarget } from '#/data/cinema/media-file/update-media-file.js'
import { upsertMovie } from '#/data/cinema/movie/upsert-movie.js'
import { upsertSeries } from '#/data/cinema/series/upsert-series.js'
import type { DbOrTx } from '#/db/index.js'
import { requireSuperAdmin } from '#/guards.js'
import {
  createTmdbClient,
  type TmdbClient,
  type TmdbEpisodeDetails,
  type TmdbMovieDetails,
  type TmdbSeriesDetails,
} from '#/lib/tmdb/index.js'
import {
  nonNegativeIntSchema,
  parseInput,
  positiveIntSchema,
  requiredUuidSchema,
} from '#/lib/validation.js'
import type { ApiModule, ModuleContext } from '#/server/modules.js'
import { releaseObject } from '#/services/quotas/index.js'

import {
  catalogKindFromWire,
  catalogSearchResultToWire,
  catalogSeasonToWire,
  catalogSeriesToWire,
  matchTargetFromWire,
  mediaFileToWire,
  withCatalogErrors,
  type CatalogMatchTarget,
} from './convert.js'

const mediaFileIdSchema = requiredUuidSchema('media_file_id')
const tmdbSeriesIdSchema = positiveIntSchema('tmdb_series_id')
const seasonNumberSchema = nonNegativeIntSchema('season_number')

type FetchedCatalogTarget =
  | { kind: 'movie'; movie: TmdbMovieDetails }
  | {
      kind: 'episode'
      series: TmdbSeriesDetails
      seasonNumber: number
      episode: TmdbEpisodeDetails
    }

function resolveTmdb(ctx: ModuleContext): TmdbClient {
  return ctx.tmdb ?? createTmdbClient({ apiKey: ctx.config.tmdbApiKey })
}

async function fetchCatalogTarget(
  tmdb: TmdbClient,
  target: CatalogMatchTarget,
): Promise<FetchedCatalogTarget> {
  if (target.kind === 'movie') {
    const movie = await withCatalogErrors(() =>
      tmdb.getMovie(target.tmdbMovieId),
    )
    if (!movie) {
      throw new ConnectError('catalog movie not found', Code.NotFound)
    }
    return { kind: 'movie', movie }
  }

  const [series, season] = await withCatalogErrors(() =>
    Promise.all([
      tmdb.getSeries(target.tmdbSeriesId),
      tmdb.getSeason(target.tmdbSeriesId, target.seasonNumber),
    ]),
  )
  if (!series) {
    throw new ConnectError('catalog series not found', Code.NotFound)
  }
  if (!season) {
    throw new ConnectError('catalog season not found', Code.NotFound)
  }
  const episode = season.episodes.find(
    (ep) => ep.episodeNumber === target.episodeNumber,
  )
  if (!episode) {
    throw new ConnectError('catalog episode not found', Code.NotFound)
  }
  return {
    kind: 'episode',
    series,
    seasonNumber: season.seasonNumber,
    episode,
  }
}

async function upsertCatalogTarget(
  tx: DbOrTx,
  fetched: FetchedCatalogTarget,
): Promise<MediaFileMatchTarget> {
  if (fetched.kind === 'movie') {
    const movie = await upsertMovie(tx, fetched.movie)
    return { kind: 'movie', movieId: movie.id }
  }
  const series = await upsertSeries(tx, fetched.series)
  const episode = await upsertEpisode(tx, {
    seriesId: series.id,
    tmdbId: fetched.episode.tmdbId,
    seasonNumber: fetched.seasonNumber,
    episodeNumber: fetched.episode.episodeNumber,
    title: fetched.episode.title,
    overview: fetched.episode.overview,
    runtimeMinutes: fetched.episode.runtimeMinutes,
    airDate: fetched.episode.airDate,
    stillPath: fetched.episode.stillPath,
  })
  return { kind: 'episode', episodeId: episode.id }
}

export const module: ApiModule = {
  name: 'cinema-matching',
  rpc(router, ctx) {
    router.rpc(CinemaService.method.searchCatalog, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const kind = catalogKindFromWire(req.kind)
      const tmdb = resolveTmdb(ctx)
      const results = await withCatalogErrors(() =>
        tmdb.search(req.query, kind),
      )
      return { results: results.map(catalogSearchResultToWire) }
    })

    router.rpc(CinemaService.method.getCatalogSeries, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const tmdbSeriesId = parseInput(tmdbSeriesIdSchema, req.tmdbSeriesId)
      const tmdb = resolveTmdb(ctx)
      const series = await withCatalogErrors(() => tmdb.getSeries(tmdbSeriesId))
      if (!series) {
        throw new ConnectError('catalog series not found', Code.NotFound)
      }
      return catalogSeriesToWire(series)
    })

    router.rpc(CinemaService.method.getCatalogSeason, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const tmdbSeriesId = parseInput(tmdbSeriesIdSchema, req.tmdbSeriesId)
      const seasonNumber = parseInput(seasonNumberSchema, req.seasonNumber)
      const tmdb = resolveTmdb(ctx)
      const season = await withCatalogErrors(() =>
        tmdb.getSeason(tmdbSeriesId, seasonNumber),
      )
      if (!season) {
        throw new ConnectError('catalog season not found', Code.NotFound)
      }
      return catalogSeasonToWire(season)
    })

    router.rpc(CinemaService.method.matchMediaFile, async (req, call) => {
      await requireSuperAdmin(call, ctx)
      const mediaFileId = parseInput(mediaFileIdSchema, req.mediaFileId)
      const target = matchTargetFromWire(req.target)

      const existing = await getMediaFileById(ctx.db, mediaFileId)
      if (!existing) {
        throw new ConnectError('media file not found', Code.NotFound)
      }

      const tmdb = resolveTmdb(ctx)
      const fetched = await fetchCatalogTarget(tmdb, target)

      const outcome = await ctx.db.transaction(async (tx) => {
        const linkTarget = await upsertCatalogTarget(tx, fetched)
        const linked = await linkMediaFileToTarget(tx, {
          mediaFileId,
          target: linkTarget,
          replaceExisting: true,
        })
        if (linked.status !== 'linked') {
          return null
        }
        const details = await getMediaFileById(tx, mediaFileId)
        return details
          ? { details, replacedObjectId: linked.replacedObjectId }
          : null
      })

      if (!outcome) {
        throw new ConnectError('media file not found', Code.NotFound)
      }

      // Release the replaced object only after the database swap commits so no live row ever
      // points at a deleted Gateway object.
      if (outcome.replacedObjectId) {
        await releaseObject(ctx, outcome.replacedObjectId)
      }

      return {
        file: mediaFileToWire(outcome.details),
        replacedExisting: outcome.replacedObjectId !== null,
      }
    })
  },
}
