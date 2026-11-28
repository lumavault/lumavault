import { upsertEpisode } from '#/data/cinema/episode/upsert-episode.js'
import { getMediaFilePage } from '#/data/cinema/media-file/get-media-file.js'
import { linkMediaFileToTarget } from '#/data/cinema/media-file/update-media-file.js'
import { upsertMovie } from '#/data/cinema/movie/upsert-movie.js'
import { upsertSeries } from '#/data/cinema/series/upsert-series.js'
import type { PageCursor } from '#/data/sql.js'
import {
  createTmdbClient,
  TmdbError,
  type TmdbClient,
  type TmdbMediaKind,
  type TmdbMovieDetails,
  type TmdbSearchResult,
  type TmdbSeasonDetails,
  type TmdbSeriesDetails,
} from '#/lib/tmdb/index.js'
import type { ApiModule, ModuleContext } from '#/server/modules.js'

import {
  parseMediaFilename,
  pickConfidentCatalogHit,
  type ParsedMediaFilename,
} from './cinema-filename.js'

// How often the background matcher sweeps for unmatched media files.
export const MATCH_INTERVAL_MS = 30_000

// Unmatched media files fetched per keyset page during one sweep.
export const MATCH_BATCH_SIZE = 50

// Wait this long before re-querying TMDB for a file that previously had no confident hit.
export const UNCERTAIN_RETRY_MS = 15 * 60 * 1000

export interface MatchSweepSummary {
  matched: number
  skipped: number
  stoppedByCatalogError: boolean
}

export interface CinemaMatcher {
  start(): void
  /** Runs one matching pass immediately and resolves when it finishes. */
  runOnce(): Promise<MatchSweepSummary>
  /** Stops scheduling sweeps and waits for any in-flight pass to finish. */
  stop(): Promise<void>
}

export interface CinemaMatcherOptions {
  intervalMs?: number
  batchSize?: number
  uncertainRetryMs?: number
  now?: () => number
  onError?: (err: unknown) => void
}

// Scoped to a single sweep so batch-uploaded episodes of one show reuse TMDB responses.
function createSweepTmdbCache(tmdb: TmdbClient) {
  const searches = new Map<string, TmdbSearchResult[]>()
  const movies = new Map<number, TmdbMovieDetails | null>()
  const series = new Map<number, TmdbSeriesDetails | null>()
  const seasons = new Map<string, TmdbSeasonDetails | null>()

  return {
    async search(query: string, kind: TmdbMediaKind) {
      const key = `${kind}:${query.toLowerCase()}`
      const cached = searches.get(key)
      if (cached) {
        return cached
      }
      const res = await tmdb.search(query, kind)
      searches.set(key, res)
      return res
    },
    async getMovie(tmdbId: number) {
      if (movies.has(tmdbId)) {
        return movies.get(tmdbId)!
      }
      const res = await tmdb.getMovie(tmdbId)
      movies.set(tmdbId, res)
      return res
    },
    async getSeries(tmdbId: number) {
      if (series.has(tmdbId)) {
        return series.get(tmdbId)!
      }
      const res = await tmdb.getSeries(tmdbId)
      series.set(tmdbId, res)
      return res
    },
    async getSeason(tmdbSeriesId: number, seasonNumber: number) {
      const key = `${tmdbSeriesId}:${seasonNumber}`
      if (seasons.has(key)) {
        return seasons.get(key)!
      }
      const res = await tmdb.getSeason(tmdbSeriesId, seasonNumber)
      seasons.set(key, res)
      return res
    },
  }
}

type SweepTmdb = ReturnType<typeof createSweepTmdbCache>

async function tryMatchOneFile(
  ctx: Pick<ModuleContext, 'db'>,
  tmdb: SweepTmdb,
  mediaFileId: string,
  parsed: ParsedMediaFilename,
): Promise<'matched' | 'uncertain' | 'unchanged'> {
  const kind: TmdbMediaKind = parsed.kind === 'movie' ? 'movie' : 'series'
  const results = await tmdb.search(parsed.title, kind)
  const hit = pickConfidentCatalogHit(results, parsed)
  if (!hit) {
    return 'uncertain'
  }

  if (parsed.kind === 'movie') {
    const movie = await tmdb.getMovie(hit.tmdbId)
    if (!movie) {
      return 'uncertain'
    }
    const linked = await ctx.db.transaction(async (tx) => {
      const row = await upsertMovie(tx, movie)
      return linkMediaFileToTarget(tx, {
        mediaFileId,
        target: { kind: 'movie', movieId: row.id },
        replaceExisting: false,
        onlyIfUnmatched: true,
      })
    })
    if (linked.status === 'linked') return 'matched'
    return linked.status === 'target_occupied' ? 'uncertain' : 'unchanged'
  }

  const [series, season] = await Promise.all([
    tmdb.getSeries(hit.tmdbId),
    tmdb.getSeason(hit.tmdbId, parsed.seasonNumber),
  ])
  if (!series || !season) {
    return 'uncertain'
  }
  const episode = season.episodes.find(
    (ep) => ep.episodeNumber === parsed.episodeNumber,
  )
  if (!episode) {
    return 'uncertain'
  }

  const linked = await ctx.db.transaction(async (tx) => {
    const seriesRow = await upsertSeries(tx, series)
    const episodeRow = await upsertEpisode(tx, {
      seriesId: seriesRow.id,
      tmdbId: episode.tmdbId,
      seasonNumber: season.seasonNumber,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      overview: episode.overview,
      runtimeMinutes: episode.runtimeMinutes,
      airDate: episode.airDate,
      stillPath: episode.stillPath,
    })
    return linkMediaFileToTarget(tx, {
      mediaFileId,
      target: { kind: 'episode', episodeId: episodeRow.id },
      replaceExisting: false,
      onlyIfUnmatched: true,
    })
  })
  if (linked.status === 'linked') return 'matched'
  return linked.status === 'target_occupied' ? 'uncertain' : 'unchanged'
}

/** Runs one pass over unmatched media files, linking confident TMDB hits and leaving uncertain ones alone. */
export async function matchUnmatchedMediaFiles(
  ctx: Pick<ModuleContext, 'db' | 'config' | 'tmdb'>,
  options: {
    batchSize?: number
    now?: () => number
    shouldStop?: () => boolean
    skipFileIds?: ReadonlySet<string>
    onFileUncertain?: (mediaFileId: string) => void
    onError?: (err: unknown) => void
  } = {},
): Promise<MatchSweepSummary> {
  const batchSize = options.batchSize ?? MATCH_BATCH_SIZE
  const now = options.now ?? Date.now
  const tmdb = createSweepTmdbCache(
    ctx.tmdb ?? createTmdbClient({ apiKey: ctx.config.tmdbApiKey }),
  )

  let matched = 0
  let skipped = 0
  let after: PageCursor | undefined

  while (!options.shouldStop?.()) {
    const page = await getMediaFilePage(ctx.db, {
      filter: 'unmatched',
      after,
      limit: batchSize,
    })
    if (page.length === 0) {
      break
    }

    for (const item of page) {
      if (options.shouldStop?.()) {
        return { matched, skipped, stoppedByCatalogError: false }
      }
      if (options.skipFileIds?.has(item.file.id)) {
        skipped += 1
        continue
      }

      const parsed = parseMediaFilename(item.file.filename, now)
      if (!parsed) {
        options.onFileUncertain?.(item.file.id)
        skipped += 1
        continue
      }

      try {
        const outcome = await tryMatchOneFile(ctx, tmdb, item.file.id, parsed)
        if (outcome === 'matched') {
          matched += 1
        } else {
          if (outcome === 'uncertain') {
            options.onFileUncertain?.(item.file.id)
          }
          skipped += 1
        }
      } catch (err) {
        if (err instanceof TmdbError) {
          if (err.reason !== 'not_configured') {
            options.onError?.(err)
          }
          // Stop the sweep immediately on TMDB outage, rate limit, or missing key so we retry later.
          return { matched, skipped, stoppedByCatalogError: true }
        }
        options.onError?.(err)
        skipped += 1
      }
    }

    if (page.length < batchSize) {
      break
    }
    const last = page[page.length - 1]!
    after = { createdAt: last.file.addedAt, id: last.file.id }
  }

  return { matched, skipped, stoppedByCatalogError: false }
}

/** Creates a periodic Cinema auto-matcher that backs off uncertain files and stops cleanly on shutdown. */
export function createCinemaMatcher(
  ctx: Pick<ModuleContext, 'db' | 'config' | 'tmdb'>,
  options: CinemaMatcherOptions = {},
): CinemaMatcher {
  const intervalMs = options.intervalMs ?? MATCH_INTERVAL_MS
  const batchSize = options.batchSize ?? MATCH_BATCH_SIZE
  const uncertainRetryMs = options.uncertainRetryMs ?? UNCERTAIN_RETRY_MS
  const now = options.now ?? Date.now
  const onError =
    options.onError ??
    ((err: unknown) => console.error('cinema matcher sweep failed', err))

  let timer: NodeJS.Timeout | undefined
  let started = false
  let stopped = false
  let inFlight: Promise<MatchSweepSummary> | null = null
  const uncertainUntil = new Map<string, number>()

  function activeSkipSet(): Set<string> {
    const current = now()
    const skip = new Set<string>()
    for (const [id, until] of uncertainUntil) {
      if (until <= current) {
        uncertainUntil.delete(id)
      } else {
        skip.add(id)
      }
    }
    return skip
  }

  function runOnce(): Promise<MatchSweepSummary> {
    if (inFlight) {
      return inFlight
    }
    const sweep = matchUnmatchedMediaFiles(ctx, {
      batchSize,
      now,
      shouldStop: () => stopped,
      skipFileIds: activeSkipSet(),
      onFileUncertain: (id) => {
        if (uncertainRetryMs > 0) {
          uncertainUntil.set(id, now() + uncertainRetryMs)
        }
      },
      onError,
    })
      .catch((err): MatchSweepSummary => {
        onError(err)
        return { matched: 0, skipped: 0, stoppedByCatalogError: false }
      })
      .finally(() => {
        if (inFlight === sweep) {
          inFlight = null
        }
      })
    inFlight = sweep
    return sweep
  }

  function scheduleLoop(): void {
    if (stopped) {
      return
    }
    void runOnce().finally(() => {
      if (stopped) {
        return
      }
      timer = setTimeout(scheduleLoop, intervalMs)
      timer.unref()
    })
  }

  return {
    start() {
      if (started) {
        return
      }
      started = true
      stopped = false
      scheduleLoop()
    },
    runOnce,
    async stop() {
      started = false
      stopped = true
      clearTimeout(timer)
      timer = undefined
      if (inFlight) {
        await inFlight
      }
    },
  }
}

let matcher: CinemaMatcher | undefined

export const module: ApiModule = {
  name: 'cinema-matcher',
  start(ctx) {
    matcher = createCinemaMatcher(ctx)
    matcher.start()
  },
  async stop() {
    await matcher?.stop()
    matcher = undefined
  },
}
