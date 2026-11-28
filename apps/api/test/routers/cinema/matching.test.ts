import { randomUUID } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  Code,
  ConnectError,
  createClient,
  type Client,
} from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import {
  CatalogErrorReason,
  CatalogErrorSchema,
  CatalogKind,
  CinemaService,
  MediaContainer,
  MediaFileFilter,
  MediaFileKind,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { SUPER_ADMIN_ROLE } from '#/auth/constants.js'
import { createHouseholdFor } from '#/auth/server-helpers.js'
import { user } from '#/db/schemas/auth.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaMovies,
  cinemaSeries,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamHouseholds, iamObjectClaims } from '#/db/schemas/iam.js'
import type {
  StorageGateway,
  StoredObject,
  UploadObjectInput,
} from '#/lib/storage-gateway.js'
import { createTmdbClient } from '#/lib/tmdb/index.js'
import { RPC_PREFIX } from '#/routes.js'
import { createApp } from '#/server/app.js'
import { loadModules, type ModuleContext } from '#/server/modules.js'
import { APP_NAMESPACE } from '#/services/quotas/index.js'
import {
  createTestContext,
  signUp,
  type TestUser,
} from '#test/support/context.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
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

  seed(objectId: string, filename: string, sizeBytes: bigint): void {
    this.objects.set(objectId, {
      id: objectId,
      namespace: APP_NAMESPACE.cinema,
      sizeBytes,
      sha256Digest: '0'.repeat(64),
      mimeType: 'video/mp4',
      filename,
    })
  }

  async stat(objectId: string): Promise<StoredObject | null> {
    return this.objects.get(objectId) ?? null
  }

  async readHead(objectId: string): Promise<Uint8Array | null> {
    return this.objects.has(objectId) ? new Uint8Array(0) : null
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

function cinemaClient(
  targetApp: Hono,
  headers?: Headers,
  options: { useHttpGet?: boolean } = {},
): Client<typeof CinemaService> {
  return createClient(
    CinemaService,
    createConnectTransport({
      baseUrl: `http://api.test${RPC_PREFIX}`,
      useHttpGet: options.useHttpGet ?? false,
      fetch: async (input, init) => targetApp.request(new Request(input, init)),
      interceptors: [
        (next) => (req) => {
          headers?.forEach((value, key) => req.header.set(key, value))
          return next(req)
        },
      ],
    }),
  )
}

async function catchConnectError(
  promise: Promise<unknown>,
): Promise<ConnectError | null> {
  try {
    await promise
    return null
  } catch (err) {
    return ConnectError.from(err)
  }
}

async function codeOf(promise: Promise<unknown>): Promise<Code | 'ok'> {
  const err = await catchConnectError(promise)
  return err ? err.code : 'ok'
}

const TMDB_API_KEY = 'test-tmdb-secret-key'

let database: TestDatabase
let gateway: FakeGateway
let tmdbServer: Server
let tmdbBaseUrl: string
let tmdbRequests: RecordedTmdbRequest[] = []
let tmdbHandler: FakeTmdbHandler
let ctx: ModuleContext
let app: Hono
let superAdmin: TestUser
let homelessSuperAdmin: TestUser
let householdOwner: TestUser
let householdMember: TestUser

function defaultTmdbHandler(
  req: RecordedTmdbRequest,
  res: ServerResponse,
): void {
  if (req.path === '/3/search/movie') {
    sendJson(res, 200, {
      results: [
        {
          id: 693134,
          title: 'Dune: Part Two',
          overview: 'Paul Atreides unites with the Fremen.',
          release_date: '2024-02-27',
          poster_path: '/should-not-leak.jpg',
        },
        {
          id: 438631,
          title: 'Dune',
          overview: 'A noble family becomes embroiled in a war.',
          release_date: '2021-09-15',
          poster_path: '/also-not-leaked.jpg',
        },
      ],
    })
    return
  }
  if (req.path === '/3/search/tv') {
    sendJson(res, 200, {
      results: [
        {
          id: 95396,
          name: 'Severance',
          overview: 'Mark leads a team of office workers.',
          first_air_date: '2022-02-18',
          poster_path: '/tv-secret.jpg',
        },
      ],
    })
    return
  }
  if (req.path === '/3/search/multi') {
    sendJson(res, 200, {
      results: [
        {
          id: 693134,
          media_type: 'movie',
          title: 'Dune: Part Two',
          overview: 'Paul Atreides unites with the Fremen.',
          release_date: '2024-02-27',
        },
        {
          id: 999,
          media_type: 'person',
          name: 'Denis Villeneuve',
        },
        {
          id: 95396,
          media_type: 'tv',
          name: 'Severance',
          overview: 'Mark leads a team of office workers.',
          first_air_date: '2022-02-18',
        },
      ],
    })
    return
  }
  if (req.path === '/3/movie/693134') {
    sendJson(res, 200, {
      id: 693134,
      title: 'Dune: Part Two',
      overview: 'Paul Atreides unites with the Fremen.',
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
  if (req.path === '/3/tv/95396') {
    sendJson(res, 200, {
      id: 95396,
      name: 'Severance',
      overview: 'Mark leads a team of office workers.',
      first_air_date: '2022-02-18',
      poster_path: '/severance-poster.jpg',
      backdrop_path: '/severance-backdrop.jpg',
      seasons: [
        {
          season_number: 2,
          name: 'Season 2',
          episode_count: 10,
          air_date: '2025-01-17',
        },
        {
          season_number: 0,
          name: 'Specials',
          episode_count: 1,
          air_date: null,
        },
        {
          season_number: 1,
          name: 'Season 1',
          episode_count: 9,
          air_date: '2022-02-18',
        },
      ],
    })
    return
  }
  if (req.path === '/3/tv/95396/season/0') {
    sendJson(res, 200, {
      season_number: 0,
      episodes: [
        {
          id: 990001,
          episode_number: 1,
          name: 'Behind the Scenes',
          overview: 'Making of Lumon.',
          air_date: null,
          runtime: 12,
          still_path: '/special-still.jpg',
        },
      ],
    })
    return
  }
  if (req.path === '/3/tv/95396/season/1') {
    sendJson(res, 200, {
      season_number: 1,
      episodes: [
        {
          id: 3328760,
          episode_number: 2,
          name: 'Half Loop',
          overview: 'The team trains new hire Helly.',
          air_date: '2022-02-18',
          runtime: 55,
          still_path: '/s01e02-still.jpg',
        },
        {
          id: 3328759,
          episode_number: 1,
          name: 'Good News About Hell',
          overview: 'Mark is promoted to lead a team.',
          air_date: '2022-02-18',
          runtime: 57,
          still_path: '/s01e01-still.jpg',
        },
      ],
    })
    return
  }
  sendJson(res, 404, { status_code: 34, status_message: 'not found' })
}

async function seedUnmatchedFile(
  filename: string,
  sizeBytes = 1_000_000n,
): Promise<{ id: string; objectId: string }> {
  const objectId = `obj-${randomUUID()}`
  gateway.seed(objectId, filename, sizeBytes)
  await database.db.insert(iamObjectClaims).values({
    objectId,
    householdId: null,
    app: 'cinema',
    bytes: sizeBytes,
    uploadedBy: superAdmin.id,
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
    apiKey: TMDB_API_KEY,
    baseUrl: tmdbBaseUrl,
    maxRetries: 1,
    initialBackoffMs: 1,
    sleep: async () => {},
  })
  ctx = createTestContext(database, { gateway, tmdb })
  app = createApp(ctx, await loadModules())

  superAdmin = await signUp(ctx, 'super@example.com')
  homelessSuperAdmin = await signUp(ctx, 'homeless-super@example.com')
  householdOwner = await signUp(ctx, 'owner@example.com')
  householdMember = await signUp(ctx, 'member@example.com')

  await database.db
    .update(user)
    .set({ role: SUPER_ADMIN_ROLE })
    .where(eq(user.id, superAdmin.id))
  await database.db
    .update(user)
    .set({ role: SUPER_ADMIN_ROLE })
    .where(eq(user.id, homelessSuperAdmin.id))

  const householdId = (await createHouseholdFor(ctx, householdOwner.id, 'Home'))
    .id
  await database.db.insert(iamHouseholds).values({
    householdId,
    storageCapBytes: 10_000_000n,
    enabledApps: ['cinema'],
  })
  await ctx.auth.api.addMember({
    body: {
      userId: householdMember.id,
      organizationId: householdId,
      role: 'member',
    },
  })
  await ctx.auth.api.addMember({
    body: {
      userId: superAdmin.id,
      organizationId: householdId,
      role: 'member',
    },
  })
})

beforeEach(async () => {
  await database.db.delete(cinemaWatchProgress)
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

describe('Super-Admin access', () => {
  const calls: [
    string,
    (client: Client<typeof CinemaService>) => Promise<unknown>,
  ][] = [
    ['SearchCatalog', (c) => c.searchCatalog({ query: 'dune' })],
    ['GetCatalogSeries', (c) => c.getCatalogSeries({ tmdbSeriesId: 95396 })],
    [
      'GetCatalogSeason',
      (c) => c.getCatalogSeason({ tmdbSeriesId: 95396, seasonNumber: 1 }),
    ],
    [
      'MatchMediaFile',
      (c) =>
        c.matchMediaFile({
          mediaFileId: randomUUID(),
          target: { case: 'tmdbMovieId', value: 693134 },
        }),
    ],
  ]

  it.each(calls)('%s rejects unauthenticated callers', async (_name, call) => {
    expect(await codeOf(call(cinemaClient(app)))).toBe(Code.Unauthenticated)
  })

  it.each(calls)(
    '%s refuses a non-Super-Admin household Member',
    async (_name, call) => {
      expect(
        await codeOf(call(cinemaClient(app, householdMember.headers))),
      ).toBe(Code.PermissionDenied)
    },
  )

  it.each(calls)(
    '%s refuses a non-Super-Admin household Owner',
    async (_name, call) => {
      expect(
        await codeOf(call(cinemaClient(app, householdOwner.headers))),
      ).toBe(Code.PermissionDenied)
    },
  )

  it('allows a Super-Admin without a household to search the catalog', async () => {
    const res = await cinemaClient(
      app,
      homelessSuperAdmin.headers,
    ).searchCatalog({
      query: 'dune',
      kind: CatalogKind.MOVIE,
    })
    expect(res.results).toHaveLength(2)
  })
})

describe('SearchCatalog, GetCatalogSeries, and GetCatalogSeason', () => {
  it('searches movies, series, and both with metadata only and supports HTTP GET', async () => {
    const client = cinemaClient(app, superAdmin.headers)
    const getClient = cinemaClient(app, superAdmin.headers, {
      useHttpGet: true,
    })

    const movies = await client.searchCatalog({
      query: 'dune',
      kind: CatalogKind.MOVIE,
    })
    expect(movies.results).toEqual([
      expect.objectContaining({
        tmdbId: 693134,
        kind: CatalogKind.MOVIE,
        title: 'Dune: Part Two',
        overview: 'Paul Atreides unites with the Fremen.',
        releaseYear: 2024,
      }),
      expect.objectContaining({
        tmdbId: 438631,
        kind: CatalogKind.MOVIE,
        title: 'Dune',
        releaseYear: 2021,
      }),
    ])
    expect(JSON.stringify(movies)).not.toContain('should-not-leak')
    expect(JSON.stringify(movies)).not.toContain('tmdb.org')

    const series = await getClient.searchCatalog({
      query: 'severance',
      kind: CatalogKind.SERIES,
    })
    expect(series.results).toHaveLength(1)
    expect(series.results[0]).toMatchObject({
      tmdbId: 95396,
      kind: CatalogKind.SERIES,
      title: 'Severance',
      releaseYear: 2022,
    })
    expect(JSON.stringify(series)).not.toContain('tv-secret')

    const multi = await client.searchCatalog({
      query: 'dune',
      kind: CatalogKind.UNSPECIFIED,
    })
    expect(multi.results.map((r) => [r.kind, r.tmdbId])).toEqual([
      [CatalogKind.MOVIE, 693134],
      [CatalogKind.SERIES, 95396],
    ])

    const blank = await client.searchCatalog({ query: '   ' })
    expect(blank.results).toEqual([])
  })

  it('returns sorted season summaries for GetCatalogSeries and episodes for GetCatalogSeason', async () => {
    const getClient = cinemaClient(app, superAdmin.headers, {
      useHttpGet: true,
    })

    const series = await getClient.getCatalogSeries({ tmdbSeriesId: 95396 })
    expect(series).toMatchObject({
      tmdbSeriesId: 95396,
      title: 'Severance',
      firstAirYear: 2022,
      seasons: [
        { seasonNumber: 0, name: 'Specials', episodeCount: 1, airDate: '' },
        {
          seasonNumber: 1,
          name: 'Season 1',
          episodeCount: 9,
          airDate: '2022-02-18',
        },
        {
          seasonNumber: 2,
          name: 'Season 2',
          episodeCount: 10,
          airDate: '2025-01-17',
        },
      ],
    })
    expect(JSON.stringify(series)).not.toContain('severance-poster')

    const season = await getClient.getCatalogSeason({
      tmdbSeriesId: 95396,
      seasonNumber: 1,
    })
    expect(season).toMatchObject({
      tmdbSeriesId: 95396,
      seasonNumber: 1,
      episodes: [
        {
          episodeNumber: 1,
          title: 'Good News About Hell',
          overview: 'Mark is promoted to lead a team.',
          airDate: '2022-02-18',
        },
        {
          episodeNumber: 2,
          title: 'Half Loop',
          overview: 'The team trains new hire Helly.',
          airDate: '2022-02-18',
        },
      ],
    })
    expect(JSON.stringify(season)).not.toContain('s01e01-still')

    const specials = await getClient.getCatalogSeason({
      tmdbSeriesId: 95396,
      seasonNumber: 0,
    })
    expect(specials.episodes).toHaveLength(1)
    expect(specials.episodes[0]).toMatchObject({
      episodeNumber: 1,
      title: 'Behind the Scenes',
      airDate: '',
    })
  })

  it('returns NotFound for missing TMDB IDs and InvalidArgument for bad inputs', async () => {
    const client = cinemaClient(app, superAdmin.headers)

    expect(
      await codeOf(
        client.searchCatalog({ query: 'dune', kind: 99 as CatalogKind }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(await codeOf(client.getCatalogSeries({ tmdbSeriesId: 0 }))).toBe(
      Code.InvalidArgument,
    )
    expect(await codeOf(client.getCatalogSeries({ tmdbSeriesId: -5 }))).toBe(
      Code.InvalidArgument,
    )
    expect(await codeOf(client.getCatalogSeries({ tmdbSeriesId: 40404 }))).toBe(
      Code.NotFound,
    )
    expect(
      await codeOf(
        client.getCatalogSeason({ tmdbSeriesId: 0, seasonNumber: 1 }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.getCatalogSeason({ tmdbSeriesId: 95396, seasonNumber: 99 }),
      ),
    ).toBe(Code.NotFound)
  })
})

describe('CatalogError mapping', () => {
  async function expectCatalogError(
    promise: Promise<unknown>,
    expectedCode: Code,
    expectedReason: CatalogErrorReason,
  ): Promise<void> {
    const err = await catchConnectError(promise)
    expect(err).not.toBeNull()
    expect(err!.code).toBe(expectedCode)
    expect(err!.message).not.toContain(TMDB_API_KEY)
    const [detail] = err!.findDetails(CatalogErrorSchema)
    expect(detail).toMatchObject({ reason: expectedReason })
  }

  it('returns FailedPrecondition with NOT_CONFIGURED when TMDB_API_KEY is unset', async () => {
    const unconfiguredCtx = createTestContext(database, { gateway })
    const unconfiguredApp = createApp(unconfiguredCtx, await loadModules())
    const client = cinemaClient(unconfiguredApp, superAdmin.headers)
    const file = await seedUnmatchedFile('Dune.Part.Two.2024.mp4')

    await expectCatalogError(
      client.searchCatalog({ query: 'dune' }),
      Code.FailedPrecondition,
      CatalogErrorReason.NOT_CONFIGURED,
    )
    await expectCatalogError(
      client.getCatalogSeries({ tmdbSeriesId: 95396 }),
      Code.FailedPrecondition,
      CatalogErrorReason.NOT_CONFIGURED,
    )
    await expectCatalogError(
      client.getCatalogSeason({ tmdbSeriesId: 95396, seasonNumber: 1 }),
      Code.FailedPrecondition,
      CatalogErrorReason.NOT_CONFIGURED,
    )
    await expectCatalogError(
      client.matchMediaFile({
        mediaFileId: file.id,
        target: { case: 'tmdbMovieId', value: 693134 },
      }),
      Code.FailedPrecondition,
      CatalogErrorReason.NOT_CONFIGURED,
    )
  })

  it('returns ResourceExhausted with RATE_LIMITED when TMDB returns 429', async () => {
    tmdbHandler = (_req, res) => {
      sendJson(res, 429, { status_message: 'rate limited' })
    }
    const client = cinemaClient(app, superAdmin.headers)
    const file = await seedUnmatchedFile('Dune.Part.Two.2024.mp4')

    await expectCatalogError(
      client.searchCatalog({ query: 'dune' }),
      Code.ResourceExhausted,
      CatalogErrorReason.RATE_LIMITED,
    )
    await expectCatalogError(
      client.getCatalogSeries({ tmdbSeriesId: 95396 }),
      Code.ResourceExhausted,
      CatalogErrorReason.RATE_LIMITED,
    )
    await expectCatalogError(
      client.getCatalogSeason({ tmdbSeriesId: 95396, seasonNumber: 1 }),
      Code.ResourceExhausted,
      CatalogErrorReason.RATE_LIMITED,
    )
    await expectCatalogError(
      client.matchMediaFile({
        mediaFileId: file.id,
        target: { case: 'tmdbMovieId', value: 693134 },
      }),
      Code.ResourceExhausted,
      CatalogErrorReason.RATE_LIMITED,
    )
  })

  it('returns Unavailable with UNAVAILABLE when TMDB is down', async () => {
    tmdbHandler = (_req, res) => {
      sendJson(res, 503, { status_message: 'service unavailable' })
    }
    const client = cinemaClient(app, superAdmin.headers)
    const file = await seedUnmatchedFile('Dune.Part.Two.2024.mp4')

    await expectCatalogError(
      client.searchCatalog({ query: 'dune' }),
      Code.Unavailable,
      CatalogErrorReason.UNAVAILABLE,
    )
    await expectCatalogError(
      client.getCatalogSeries({ tmdbSeriesId: 95396 }),
      Code.Unavailable,
      CatalogErrorReason.UNAVAILABLE,
    )
    await expectCatalogError(
      client.getCatalogSeason({ tmdbSeriesId: 95396, seasonNumber: 1 }),
      Code.Unavailable,
      CatalogErrorReason.UNAVAILABLE,
    )
    await expectCatalogError(
      client.matchMediaFile({
        mediaFileId: file.id,
        target: { case: 'tmdbMovieId', value: 693134 },
      }),
      Code.Unavailable,
      CatalogErrorReason.UNAVAILABLE,
    )
  })
})

describe('MatchMediaFile', () => {
  it('matches a movie, stores internal TMDB art paths, and exposes it in browse without TMDB URLs', async () => {
    const file = await seedUnmatchedFile('Dune.Part.Two.2024.mp4', 4_200_000n)
    const client = cinemaClient(app, superAdmin.headers)

    const res = await client.matchMediaFile({
      mediaFileId: file.id,
      target: { case: 'tmdbMovieId', value: 693134 },
    })

    expect(res.replacedExisting).toBe(false)
    expect(res.file).toMatchObject({
      id: file.id,
      objectId: file.objectId,
      filename: 'Dune.Part.Two.2024.mp4',
      sizeBytes: 4_200_000n,
      kind: MediaFileKind.ORIGINAL,
      container: MediaContainer.MP4,
      match: {
        case: 'movie',
        value: {
          tmdbId: 693134,
          title: 'Dune: Part Two',
          releaseYear: 2024,
        },
      },
    })

    const [movieRow] = await database.db.select().from(cinemaMovies)
    expect(movieRow).toMatchObject({
      tmdbId: 693134,
      title: 'Dune: Part Two',
      overview: 'Paul Atreides unites with the Fremen.',
      releaseYear: 2024,
      runtimeMinutes: 166,
      posterPath: '/dune2-poster.jpg',
      backdropPath: '/dune2-backdrop.jpg',
      posterObjectId: null,
      backdropObjectId: null,
    })

    const browse = await client.getMovie({ movieId: movieRow!.id })
    expect(browse.movie).toMatchObject({
      id: movieRow!.id,
      title: 'Dune: Part Two',
      posterUrl: '',
      backdropUrl: '',
    })

    const matchedList = await client.listMediaFiles({
      filter: MediaFileFilter.MATCHED,
    })
    expect(matchedList.files.map((f) => f.id)).toEqual([file.id])
  })

  it('matches two episodes of one show under one shared series row with internal art paths', async () => {
    const ep1File = await seedUnmatchedFile('Severance.S01E01.mp4', 2_000_000n)
    const ep2File = await seedUnmatchedFile('Severance.S01E02.mp4', 2_100_000n)
    const specialFile = await seedUnmatchedFile(
      'Severance.S00E01.mp4',
      500_000n,
    )
    const client = cinemaClient(app, superAdmin.headers)

    const r1 = await client.matchMediaFile({
      mediaFileId: ep1File.id,
      target: {
        case: 'episode',
        value: { tmdbSeriesId: 95396, seasonNumber: 1, episodeNumber: 1 },
      },
    })
    const r2 = await client.matchMediaFile({
      mediaFileId: ep2File.id,
      target: {
        case: 'episode',
        value: { tmdbSeriesId: 95396, seasonNumber: 1, episodeNumber: 2 },
      },
    })
    const r0 = await client.matchMediaFile({
      mediaFileId: specialFile.id,
      target: {
        case: 'episode',
        value: { tmdbSeriesId: 95396, seasonNumber: 0, episodeNumber: 1 },
      },
    })

    expect(r1.replacedExisting).toBe(false)
    expect(r2.replacedExisting).toBe(false)
    expect(r0.replacedExisting).toBe(false)

    const seriesRows = await database.db.select().from(cinemaSeries)
    expect(seriesRows).toHaveLength(1)
    expect(seriesRows[0]).toMatchObject({
      tmdbId: 95396,
      title: 'Severance',
      firstAirYear: 2022,
      posterPath: '/severance-poster.jpg',
      backdropPath: '/severance-backdrop.jpg',
    })

    const episodeRows = await database.db.select().from(cinemaEpisodes)
    expect(episodeRows).toHaveLength(3)
    expect(episodeRows.every((e) => e.seriesId === seriesRows[0]!.id)).toBe(
      true,
    )
    const ep1Row = episodeRows.find(
      (e) => e.seasonNumber === 1 && e.episodeNumber === 1,
    )
    expect(ep1Row).toMatchObject({
      tmdbId: 3328759,
      title: 'Good News About Hell',
      airDate: '2022-02-18',
      runtimeMinutes: 57,
      stillPath: '/s01e01-still.jpg',
    })

    const browseSeries = await client.getSeries({ seriesId: seriesRows[0]!.id })
    expect(browseSeries.series?.seasons.map((s) => s.seasonNumber)).toEqual([
      0, 1,
    ])
    expect(
      browseSeries.series?.seasons[1]?.episodes.map((e) => [
        e.episodeNumber,
        e.title,
      ]),
    ).toEqual([
      [1, 'Good News About Hell'],
      [2, 'Half Loop'],
    ])
  })

  it('replaces an existing original movie file, releases it from the Gateway, and keeps watch progress', async () => {
    const first = await seedUnmatchedFile('Dune.Part.Two.1080p.mp4', 1_000n)
    const second = await seedUnmatchedFile('Dune.Part.Two.2160p.mp4', 4_000n)
    const client = cinemaClient(app, superAdmin.headers)

    const initial = await client.matchMediaFile({
      mediaFileId: first.id,
      target: { case: 'tmdbMovieId', value: 693134 },
    })
    const movieId =
      initial.file!.match.case === 'movie'
        ? initial.file!.match.value.movieId
        : ''
    expect(movieId).not.toBe('')

    await client.reportProgress({
      target: { target: { case: 'movieId', value: movieId } },
      positionMs: 120_000n,
      durationMs: 600_000n,
    })

    const replaced = await client.matchMediaFile({
      mediaFileId: second.id,
      target: { case: 'tmdbMovieId', value: 693134 },
    })
    expect(replaced.replacedExisting).toBe(true)
    expect(replaced.file?.id).toBe(second.id)
    expect(replaced.file?.match).toMatchObject({
      case: 'movie',
      value: { movieId, tmdbId: 693134 },
    })

    const files = await database.db.select().from(cinemaMediaFiles)
    expect(files.map((f) => f.id)).toEqual([second.id])

    expect(gateway.deleted).toEqual([first.objectId])
    expect(gateway.objects.has(first.objectId)).toBe(false)
    expect(gateway.objects.has(second.objectId)).toBe(true)

    const [oldClaim] = await database.db
      .select()
      .from(iamObjectClaims)
      .where(eq(iamObjectClaims.objectId, first.objectId))
    expect(oldClaim?.releasedAt).not.toBeNull()

    const browse = await client.getMovie({ movieId })
    expect(browse.movie?.progress?.positionMs).toBe(120_000n)
  })

  it('replaces an existing original episode file and releases the old object from the Gateway', async () => {
    const first = await seedUnmatchedFile('Severance.S01E01.720p.mp4', 1_000n)
    const second = await seedUnmatchedFile('Severance.S01E01.2160p.mp4', 3_000n)
    const client = cinemaClient(app, superAdmin.headers)

    await client.matchMediaFile({
      mediaFileId: first.id,
      target: {
        case: 'episode',
        value: { tmdbSeriesId: 95396, seasonNumber: 1, episodeNumber: 1 },
      },
    })
    const replaced = await client.matchMediaFile({
      mediaFileId: second.id,
      target: {
        case: 'episode',
        value: { tmdbSeriesId: 95396, seasonNumber: 1, episodeNumber: 1 },
      },
    })

    expect(replaced.replacedExisting).toBe(true)
    expect(replaced.file?.id).toBe(second.id)
    expect(gateway.deleted).toEqual([first.objectId])
    expect(gateway.objects.has(first.objectId)).toBe(false)

    const files = await database.db.select().from(cinemaMediaFiles)
    expect(files.map((f) => f.id)).toEqual([second.id])
  })

  it('keeps the file intact when re-matching it to the same target and allows moving a wrong match', async () => {
    const file = await seedUnmatchedFile('misnamed.mp4', 1_000n)
    const client = cinemaClient(app, superAdmin.headers)

    const first = await client.matchMediaFile({
      mediaFileId: file.id,
      target: { case: 'tmdbMovieId', value: 693134 },
    })
    const same = await client.matchMediaFile({
      mediaFileId: file.id,
      target: { case: 'tmdbMovieId', value: 693134 },
    })
    expect(same.replacedExisting).toBe(false)
    expect(same.file?.id).toBe(file.id)
    expect(gateway.deleted).toEqual([])
    expect(gateway.objects.has(file.objectId)).toBe(true)

    // Move the same file from a movie to an episode, then to another movie.
    const asEpisode = await client.matchMediaFile({
      mediaFileId: file.id,
      target: {
        case: 'episode',
        value: { tmdbSeriesId: 95396, seasonNumber: 1, episodeNumber: 1 },
      },
    })
    expect(asEpisode.replacedExisting).toBe(false)
    expect(asEpisode.file?.match.case).toBe('episode')

    const oldMovieId =
      first.file!.match.case === 'movie' ? first.file!.match.value.movieId : ''
    expect(await codeOf(client.getMovie({ movieId: oldMovieId }))).toBe(
      Code.NotFound,
    )

    const asOtherMovie = await client.matchMediaFile({
      mediaFileId: file.id,
      target: { case: 'tmdbMovieId', value: 603 },
    })
    expect(asOtherMovie.replacedExisting).toBe(false)
    expect(asOtherMovie.file?.match).toMatchObject({
      case: 'movie',
      value: { tmdbId: 603, title: 'The Matrix' },
    })
    expect(gateway.deleted).toEqual([])
  })

  it('serializes concurrent matches to the same movie without losing integrity', async () => {
    const fileA = await seedUnmatchedFile('Dune.A.mp4', 1_000n)
    const fileB = await seedUnmatchedFile('Dune.B.mp4', 2_000n)
    const client = cinemaClient(app, superAdmin.headers)

    const results = await Promise.all([
      client.matchMediaFile({
        mediaFileId: fileA.id,
        target: { case: 'tmdbMovieId', value: 693134 },
      }),
      client.matchMediaFile({
        mediaFileId: fileB.id,
        target: { case: 'tmdbMovieId', value: 693134 },
      }),
    ])

    expect(results.filter((r) => r.replacedExisting)).toHaveLength(1)
    expect(results.filter((r) => !r.replacedExisting)).toHaveLength(1)

    const remaining = await database.db.select().from(cinemaMediaFiles)
    expect(remaining).toHaveLength(1)
    expect(gateway.deleted).toHaveLength(1)
    expect(gateway.deleted[0]).not.toBe(remaining[0]!.objectId)
  })

  it('rejects invalid inputs and missing media files or catalog items', async () => {
    const file = await seedUnmatchedFile('file.mp4')
    const client = cinemaClient(app, superAdmin.headers)

    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: '',
          target: { case: 'tmdbMovieId', value: 693134 },
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: 'not-a-uuid',
          target: { case: 'tmdbMovieId', value: 693134 },
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: file.id,
          target: { case: undefined },
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: file.id,
          target: { case: 'tmdbMovieId', value: 0 },
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: file.id,
          target: {
            case: 'episode',
            value: { tmdbSeriesId: 95396, seasonNumber: 1, episodeNumber: 0 },
          },
        }),
      ),
    ).toBe(Code.InvalidArgument)

    // Missing media file fails without hitting TMDB.
    const callsBefore = tmdbRequests.length
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: randomUUID(),
          target: { case: 'tmdbMovieId', value: 693134 },
        }),
      ),
    ).toBe(Code.NotFound)
    expect(tmdbRequests.length).toBe(callsBefore)

    // Missing movie, series, season, or episode on TMDB returns NotFound.
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: file.id,
          target: { case: 'tmdbMovieId', value: 40404 },
        }),
      ),
    ).toBe(Code.NotFound)
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: file.id,
          target: {
            case: 'episode',
            value: { tmdbSeriesId: 40404, seasonNumber: 1, episodeNumber: 1 },
          },
        }),
      ),
    ).toBe(Code.NotFound)
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: file.id,
          target: {
            case: 'episode',
            value: { tmdbSeriesId: 95396, seasonNumber: 9, episodeNumber: 1 },
          },
        }),
      ),
    ).toBe(Code.NotFound)
    expect(
      await codeOf(
        client.matchMediaFile({
          mediaFileId: file.id,
          target: {
            case: 'episode',
            value: { tmdbSeriesId: 95396, seasonNumber: 1, episodeNumber: 99 },
          },
        }),
      ),
    ).toBe(Code.NotFound)
  })
})
