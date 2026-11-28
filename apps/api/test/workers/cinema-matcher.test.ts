import { randomUUID } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { getMediaFileById } from '#/data/cinema/media-file/get-media-file.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaMovies,
  cinemaSeries,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import type {
  StorageGateway,
  StoredObject,
  UploadObjectInput,
} from '#/lib/storage-gateway.js'
import {
  createTmdbClient,
  TmdbError,
  type TmdbSearchResult,
} from '#/lib/tmdb/index.js'
import type { ModuleContext } from '#/server/modules.js'
import { APP_NAMESPACE } from '#/services/quotas/index.js'
import {
  parseMediaFilename,
  pickConfidentCatalogHit,
} from '#/workers/cinema-filename.js'
import {
  createCinemaMatcher,
  matchUnmatchedMediaFiles,
} from '#/workers/cinema-matcher.js'
import { createTestContext } from '#test/support/context.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

interface RecordedTmdbRequest {
  path: string
  searchParams: URLSearchParams
}

type FakeTmdbHandler = (
  req: RecordedTmdbRequest,
  res: ServerResponse,
) => void | Promise<void>

class FakeGateway implements StorageGateway {
  objects = new Map<string, StoredObject>()
  deleted: string[] = []

  async stat(objectId: string): Promise<StoredObject | null> {
    return this.objects.get(objectId) ?? null
  }
  async readHead(): Promise<Uint8Array | null> {
    return null
  }
  async upload(input: UploadObjectInput): Promise<StoredObject> {
    const id = randomUUID()
    const stored: StoredObject = {
      id,
      namespace: input.namespace,
      sizeBytes: BigInt(input.bytes.byteLength),
      sha256Digest: '0'.repeat(64),
      mimeType: input.mimeType,
      filename: input.filename,
    }
    this.objects.set(id, stored)
    return stored
  }
  async delete(objectId: string): Promise<void> {
    this.deleted.push(objectId)
    this.objects.delete(objectId)
  }
  async setThumbnail(): Promise<void> {}
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const FIXED_NOW = () => Date.UTC(2026, 10, 28)

describe('parseMediaFilename', () => {
  it.each([
    [
      'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.H.265.mp4',
      { kind: 'movie', title: 'Dune Part Two', year: 2024 },
    ],
    [
      'The Matrix (1999).mp4',
      { kind: 'movie', title: 'The Matrix', year: 1999 },
    ],
    [
      'Inception [2010] [1080p].mov',
      { kind: 'movie', title: 'Inception', year: 2010 },
    ],
    [
      '2001.A.Space.Odyssey.1968.Remux.mp4',
      { kind: 'movie', title: '2001 A Space Odyssey', year: 1968 },
    ],
    [
      'Blade.Runner.2049.2017.2160p.mp4',
      { kind: 'movie', title: 'Blade Runner 2049', year: 2017 },
    ],
    [
      'Blade.Runner.2049.2160p.WEB-DL.mp4',
      { kind: 'movie', title: 'Blade Runner 2049', year: null },
    ],
    ['1917.2019.1080p.mp4', { kind: 'movie', title: '1917', year: 2019 }],
    ['1917.mp4', { kind: 'movie', title: '1917', year: null }],
    [
      'Spider-Man.No.Way.Home.2021.1080p.mp4',
      { kind: 'movie', title: 'Spider-Man No Way Home', year: 2021 },
    ],
    [
      'Interstellar.1080p.BluRay.x264.mp4',
      { kind: 'movie', title: 'Interstellar', year: null },
    ],
    ['Video.1920x1080.mp4', { kind: 'movie', title: 'Video', year: null }],
  ] as const)('parses movie filename %s', (filename, expected) => {
    expect(parseMediaFilename(filename, FIXED_NOW)).toEqual(expected)
  })

  it.each([
    [
      'Breaking.Bad.S01E02.720p.BluRay.mp4',
      {
        kind: 'episode',
        title: 'Breaking Bad',
        year: null,
        seasonNumber: 1,
        episodeNumber: 2,
      },
    ],
    [
      'Severance - S01E01 - Good News About Hell.mp4',
      {
        kind: 'episode',
        title: 'Severance',
        year: null,
        seasonNumber: 1,
        episodeNumber: 1,
      },
    ],
    [
      'Doctor.Who.2005.S01E01.Rose.mp4',
      {
        kind: 'episode',
        title: 'Doctor Who',
        year: 2005,
        seasonNumber: 1,
        episodeNumber: 1,
      },
    ],
    [
      '1883.S01E01.1080p.mp4',
      {
        kind: 'episode',
        title: '1883',
        year: null,
        seasonNumber: 1,
        episodeNumber: 1,
      },
    ],
    [
      'Severance.S00E01.Special.mp4',
      {
        kind: 'episode',
        title: 'Severance',
        year: null,
        seasonNumber: 0,
        episodeNumber: 1,
      },
    ],
    [
      'Breaking.Bad.1x02.Cats.in.the.Bag.mp4',
      {
        kind: 'episode',
        title: 'Breaking Bad',
        year: null,
        seasonNumber: 1,
        episodeNumber: 2,
      },
    ],
    [
      'Severance Season 1 Episode 2.mov',
      {
        kind: 'episode',
        title: 'Severance',
        year: null,
        seasonNumber: 1,
        episodeNumber: 2,
      },
    ],
  ] as const)('parses episode filename %s', (filename, expected) => {
    expect(parseMediaFilename(filename, FIXED_NOW)).toEqual(expected)
  })

  it.each([
    'Breaking.Bad.S01E01E02.mp4',
    'Breaking.Bad.S01E01-E02.mp4',
    'Breaking.Bad.S01E01-02.mp4',
    'S01E01.mp4',
    'Show.S01E00.mp4',
    '.mp4',
    '   ',
  ])('returns null for ambiguous or invalid filename %s', (filename) => {
    expect(parseMediaFilename(filename, FIXED_NOW)).toBeNull()
  })
})

describe('pickConfidentCatalogHit', () => {
  const duneResults: TmdbSearchResult[] = [
    {
      tmdbId: 438631,
      kind: 'movie',
      title: 'Dune',
      overview: '',
      releaseYear: 2021,
    },
    {
      tmdbId: 841,
      kind: 'movie',
      title: 'Dune',
      overview: '',
      releaseYear: 1984,
    },
    {
      tmdbId: 693134,
      kind: 'movie',
      title: 'Dune: Part Two',
      overview: '',
      releaseYear: 2024,
    },
  ]

  it('uses year to disambiguate identical titles and leaves yearless ties uncertain', () => {
    expect(
      pickConfidentCatalogHit(duneResults, {
        kind: 'movie',
        title: 'Dune',
        year: 2021,
      })?.tmdbId,
    ).toBe(438631)
    expect(
      pickConfidentCatalogHit(duneResults, {
        kind: 'movie',
        title: 'Dune',
        year: 1984,
      })?.tmdbId,
    ).toBe(841)
    expect(
      pickConfidentCatalogHit(duneResults, {
        kind: 'movie',
        title: 'Dune',
        year: null,
      }),
    ).toBeNull()
    expect(
      pickConfidentCatalogHit(duneResults, {
        kind: 'movie',
        title: 'Dune',
        year: 1995,
      }),
    ).toBeNull()
  })

  it('matches normalized punctuation, apostrophes, and leading articles with year', () => {
    const matrix: TmdbSearchResult[] = [
      {
        tmdbId: 603,
        kind: 'movie',
        title: 'The Matrix',
        overview: '',
        releaseYear: 1999,
      },
    ]
    expect(
      pickConfidentCatalogHit(matrix, {
        kind: 'movie',
        title: 'Matrix',
        year: 1999,
      })?.tmdbId,
    ).toBe(603)

    const schindler: TmdbSearchResult[] = [
      {
        tmdbId: 424,
        kind: 'movie',
        title: "Schindler's List",
        overview: '',
        releaseYear: 1993,
      },
    ]
    expect(
      pickConfidentCatalogHit(schindler, {
        kind: 'movie',
        title: 'Schindlers List',
        year: 1993,
      })?.tmdbId,
    ).toBe(424)
  })
})

describe('cinema-matcher worker', () => {
  let database: TestDatabase
  let gateway: FakeGateway
  let tmdbServer: Server
  let tmdbBaseUrl: string
  let tmdbRequests: RecordedTmdbRequest[] = []
  let tmdbHandler: FakeTmdbHandler
  let ctx: ModuleContext

  function defaultTmdbHandler(
    req: RecordedTmdbRequest,
    res: ServerResponse,
  ): void {
    const q = (req.searchParams.get('query') ?? '').toLowerCase()

    if (req.path === '/3/search/movie') {
      if (q === 'dune part two') {
        sendJson(res, 200, {
          results: [
            {
              id: 693134,
              title: 'Dune: Part Two',
              overview: 'Paul unites with the Fremen.',
              release_date: '2024-02-27',
            },
          ],
        })
        return
      }
      if (q === 'dune') {
        sendJson(res, 200, {
          results: [
            {
              id: 438631,
              title: 'Dune',
              overview: '2021 adaptation.',
              release_date: '2021-09-15',
            },
            {
              id: 841,
              title: 'Dune',
              overview: '1984 adaptation.',
              release_date: '1984-12-14',
            },
          ],
        })
        return
      }
      if (q === 'the matrix') {
        sendJson(res, 200, {
          results: [
            {
              id: 603,
              title: 'The Matrix',
              overview: 'A hacker learns the truth.',
              release_date: '1999-03-31',
            },
          ],
        })
        return
      }
      sendJson(res, 200, { results: [] })
      return
    }

    if (req.path === '/3/search/tv') {
      if (q === 'breaking bad') {
        sendJson(res, 200, {
          results: [
            {
              id: 1396,
              name: 'Breaking Bad',
              overview: 'A chemistry teacher turns to crime.',
              first_air_date: '2008-01-20',
            },
          ],
        })
        return
      }
      sendJson(res, 200, { results: [] })
      return
    }

    if (req.path === '/3/movie/693134') {
      sendJson(res, 200, {
        id: 693134,
        title: 'Dune: Part Two',
        overview: 'Paul unites with the Fremen.',
        release_date: '2024-02-27',
        runtime: 166,
        poster_path: '/dune2-poster.jpg',
        backdrop_path: '/dune2-backdrop.jpg',
      })
      return
    }

    if (req.path === '/3/movie/603') {
      sendJson(res, 200, {
        id: 603,
        title: 'The Matrix',
        overview: 'A hacker learns the truth.',
        release_date: '1999-03-31',
        runtime: 136,
        poster_path: '/matrix-poster.jpg',
        backdrop_path: '/matrix-backdrop.jpg',
      })
      return
    }

    if (req.path === '/3/tv/1396') {
      sendJson(res, 200, {
        id: 1396,
        name: 'Breaking Bad',
        overview: 'A chemistry teacher turns to crime.',
        first_air_date: '2008-01-20',
        poster_path: '/bb-poster.jpg',
        backdrop_path: '/bb-backdrop.jpg',
        seasons: [
          {
            season_number: 1,
            name: 'Season 1',
            episode_count: 7,
            air_date: '2008-01-20',
          },
        ],
      })
      return
    }

    if (req.path === '/3/tv/1396/season/1') {
      sendJson(res, 200, {
        season_number: 1,
        episodes: [
          {
            id: 62085,
            episode_number: 1,
            name: 'Pilot',
            overview: 'Walter White gets a diagnosis.',
            air_date: '2008-01-20',
            runtime: 58,
            still_path: '/bb-s01e01.jpg',
          },
          {
            id: 62086,
            episode_number: 2,
            name: "Cat's in the Bag...",
            overview: 'Walt and Jesse deal with the aftermath.',
            air_date: '2008-01-27',
            runtime: 48,
            still_path: '/bb-s01e02.jpg',
          },
        ],
      })
      return
    }

    sendJson(res, 404, { status_code: 34, status_message: 'not found' })
  }

  async function seedUnmatchedFile(filename: string): Promise<{
    id: string
    objectId: string
  }> {
    const objectId = `obj-${randomUUID()}`
    gateway.objects.set(objectId, {
      id: objectId,
      namespace: APP_NAMESPACE.cinema,
      sizeBytes: 1_000_000n,
      sha256Digest: '0'.repeat(64),
      mimeType: 'video/mp4',
      filename,
    })
    await database.db.insert(iamObjectClaims).values({
      objectId,
      householdId: null,
      app: 'cinema',
      bytes: 1_000_000n,
    })
    const [row] = await database.db
      .insert(cinemaMediaFiles)
      .values({
        objectId,
        filename,
        container: 'mp4',
        kind: 'original',
      })
      .returning()
    return { id: row!.id, objectId }
  }

  beforeAll(async () => {
    tmdbServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const recorded: RecordedTmdbRequest = {
        path: url.pathname,
        searchParams: url.searchParams,
      }
      tmdbRequests.push(recorded)
      Promise.resolve(tmdbHandler(recorded, res)).catch((err: unknown) => {
        res.writeHead(500)
        res.end(String(err))
      })
    })
    await new Promise<void>((resolve) =>
      tmdbServer.listen(0, '127.0.0.1', resolve),
    )
    const address = tmdbServer.address() as AddressInfo
    tmdbBaseUrl = `http://127.0.0.1:${address.port}/3`

    database = await createTestDatabase()
    await pushAllSchemas(database)
    gateway = new FakeGateway()
    const tmdb = createTmdbClient({
      apiKey: 'worker-test-key',
      baseUrl: tmdbBaseUrl,
      maxRetries: 1,
      initialBackoffMs: 1,
      sleep: async () => {},
    })
    ctx = createTestContext(database, { gateway, tmdb })
  })

  beforeEach(async () => {
    await database.db.delete(cinemaMediaFiles)
    await database.db.delete(cinemaEpisodes)
    await database.db.delete(cinemaSeries)
    await database.db.delete(cinemaMovies)
    await database.db.delete(iamObjectClaims)
    gateway.objects.clear()
    gateway.deleted = []
    tmdbRequests = []
    tmdbHandler = defaultTmdbHandler
  })

  afterAll(async () => {
    await database?.drop()
    await new Promise<void>((resolve, reject) =>
      tmdbServer.close((err) => (err ? reject(err) : resolve())),
    )
  })

  it('matches common movie and episode filenames, shares one series row, and leaves uncertain files unmatched', async () => {
    const dune = await seedUnmatchedFile('Dune.Part.Two.2024.2160p.WEB-DL.mp4')
    const matrix = await seedUnmatchedFile('The Matrix (1999).mp4')
    const bb1 = await seedUnmatchedFile('Breaking.Bad.S01E01.720p.BluRay.mp4')
    const bb2 = await seedUnmatchedFile('Breaking.Bad.1x02.mp4')
    const ambiguous = await seedUnmatchedFile('Dune.mp4')
    const unknown = await seedUnmatchedFile('IMG_4821.mov')

    const summary = await matchUnmatchedMediaFiles(ctx, { now: FIXED_NOW })
    expect(summary).toEqual({
      matched: 4,
      skipped: 2,
      stoppedByCatalogError: false,
    })

    const duneFile = await getMediaFileById(database.db, dune.id)
    expect(duneFile?.movie).toMatchObject({
      tmdbId: 693134,
      title: 'Dune: Part Two',
      posterPath: '/dune2-poster.jpg',
      backdropPath: '/dune2-backdrop.jpg',
    })

    const matrixFile = await getMediaFileById(database.db, matrix.id)
    expect(matrixFile?.movie).toMatchObject({
      tmdbId: 603,
      title: 'The Matrix',
    })

    const ep1File = await getMediaFileById(database.db, bb1.id)
    const ep2File = await getMediaFileById(database.db, bb2.id)
    expect(ep1File?.series?.tmdbId).toBe(1396)
    expect(ep2File?.series?.id).toBe(ep1File?.series?.id)
    expect(ep1File?.episode).toMatchObject({
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Pilot',
      stillPath: '/bb-s01e01.jpg',
    })
    expect(ep2File?.episode).toMatchObject({
      seasonNumber: 1,
      episodeNumber: 2,
      title: "Cat's in the Bag...",
      stillPath: '/bb-s01e02.jpg',
    })

    const seriesRows = await database.db.select().from(cinemaSeries)
    expect(seriesRows).toHaveLength(1)

    // Both episodes reused the same per-sweep TMDB series and season lookup.
    expect(tmdbRequests.filter((r) => r.path === '/3/tv/1396')).toHaveLength(1)
    expect(
      tmdbRequests.filter((r) => r.path === '/3/tv/1396/season/1'),
    ).toHaveLength(1)

    // Ambiguous and unrecognized files stay unmatched.
    const ambiguousFile = await getMediaFileById(database.db, ambiguous.id)
    const unknownFile = await getMediaFileById(database.db, unknown.id)
    expect(ambiguousFile?.movie).toBeNull()
    expect(ambiguousFile?.episode).toBeNull()
    expect(unknownFile?.movie).toBeNull()
    expect(unknownFile?.episode).toBeNull()
  })

  it('does not overwrite an existing original file in the background', async () => {
    const first = await seedUnmatchedFile('The.Matrix.1999.1080p.mp4')
    const duplicate = await seedUnmatchedFile('The.Matrix.1999.2160p.mp4')

    const summary = await matchUnmatchedMediaFiles(ctx, { now: FIXED_NOW })
    expect(summary).toEqual({
      matched: 1,
      skipped: 1,
      stoppedByCatalogError: false,
    })

    const firstAfter = await getMediaFileById(database.db, first.id)
    const duplicateAfter = await getMediaFileById(database.db, duplicate.id)
    expect(firstAfter?.movie?.tmdbId).toBe(603)
    expect(duplicateAfter?.movie).toBeNull()
    expect(gateway.deleted).toEqual([])
  })

  it('does not overwrite a manual match made while TMDB is being fetched', async () => {
    const file = await seedUnmatchedFile('The.Matrix.1999.mp4')
    const [manualMovie] = await database.db
      .insert(cinemaMovies)
      .values({
        tmdbId: 693134,
        title: 'Dune: Part Two',
        releaseYear: 2024,
      })
      .returning()

    tmdbHandler = async (req, res) => {
      if (req.path === '/3/movie/603') {
        await database.db
          .update(cinemaMediaFiles)
          .set({ movieId: manualMovie!.id })
          .where(eq(cinemaMediaFiles.id, file.id))
      }
      defaultTmdbHandler(req, res)
    }

    const summary = await matchUnmatchedMediaFiles(ctx, { now: FIXED_NOW })
    expect(summary).toEqual({
      matched: 0,
      skipped: 1,
      stoppedByCatalogError: false,
    })
    const after = await getMediaFileById(database.db, file.id)
    expect(after?.movie?.tmdbId).toBe(693134)
  })

  it('backs off uncertain files until cooldown expires', async () => {
    await seedUnmatchedFile('IMG_4821.mov')
    let currentTime = FIXED_NOW()
    const matcher = createCinemaMatcher(ctx, {
      uncertainRetryMs: 60_000,
      now: () => currentTime,
      onError: () => {},
    })

    await matcher.runOnce()
    expect(tmdbRequests).toHaveLength(1)

    // Still inside cooldown: no new TMDB call is made.
    currentTime += 30_000
    await matcher.runOnce()
    expect(tmdbRequests).toHaveLength(1)

    // Once cooldown expires, the file is checked again.
    currentTime += 30_000
    await matcher.runOnce()
    expect(tmdbRequests).toHaveLength(2)
  })

  it('retries on a later run when TMDB is down or rate-limits', async () => {
    const file = await seedUnmatchedFile('Dune.Part.Two.2024.mp4')
    const errors: unknown[] = []
    const matcher = createCinemaMatcher(ctx, {
      now: FIXED_NOW,
      onError: (err) => errors.push(err),
    })

    // First sweep: TMDB returns 503.
    tmdbHandler = (_req, res) => {
      sendJson(res, 503, { status_message: 'unavailable' })
    }
    const downSummary = await matcher.runOnce()
    expect(downSummary).toEqual({
      matched: 0,
      skipped: 0,
      stoppedByCatalogError: true,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(TmdbError)
    expect((await getMediaFileById(database.db, file.id))?.movie).toBeNull()

    // Second sweep: TMDB returns 429.
    tmdbHandler = (_req, res) => {
      sendJson(res, 429, { status_message: 'rate limited' })
    }
    const rateSummary = await matcher.runOnce()
    expect(rateSummary).toEqual({
      matched: 0,
      skipped: 0,
      stoppedByCatalogError: true,
    })
    expect(errors).toHaveLength(2)

    // Third sweep: TMDB recovers and the file matches cleanly.
    tmdbHandler = defaultTmdbHandler
    const recovered = await matcher.runOnce()
    expect(recovered).toEqual({
      matched: 1,
      skipped: 0,
      stoppedByCatalogError: false,
    })
    expect((await getMediaFileById(database.db, file.id))?.movie?.tmdbId).toBe(
      693134,
    )
  })

  it('skips silently when TMDB_API_KEY is not configured', async () => {
    await seedUnmatchedFile('Dune.Part.Two.2024.mp4')
    const unconfiguredCtx = createTestContext(database, { gateway })
    const errors: unknown[] = []

    const summary = await matchUnmatchedMediaFiles(unconfiguredCtx, {
      now: FIXED_NOW,
      onError: (err) => errors.push(err),
    })
    expect(summary).toEqual({
      matched: 0,
      skipped: 0,
      stoppedByCatalogError: true,
    })
    expect(errors).toEqual([])
  })

  it('stops cleanly on shutdown while a sweep is in progress', async () => {
    await seedUnmatchedFile('Dune.Part.Two.2024.mp4')
    await seedUnmatchedFile('The.Matrix.1999.mp4')

    let releaseFirstRequest!: () => void
    const firstRequestStarted = new Promise<void>((resolve) => {
      let count = 0
      tmdbHandler = async (req, res) => {
        count += 1
        if (count === 1) {
          resolve()
          await new Promise<void>((done) => {
            releaseFirstRequest = done
          })
        }
        defaultTmdbHandler(req, res)
      }
    })

    const matcher = createCinemaMatcher(ctx, {
      intervalMs: 10,
      now: FIXED_NOW,
      onError: () => {},
    })
    matcher.start()
    await firstRequestStarted

    const stopPromise = matcher.stop()
    releaseFirstRequest()
    await stopPromise

    const requestsAtStop = tmdbRequests.length
    await new Promise((resolve) => setTimeout(resolve, 40))
    // No further sweeps ran after stop() resolved.
    expect(tmdbRequests.length).toBe(requestsAtStop)
  })
})
