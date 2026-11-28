import { randomUUID } from 'node:crypto'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import {
  Code,
  ConnectError,
  createClient,
  type Client,
} from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { LumaVaultClient, Namespace } from '@lumavault/sdk'
import {
  CinemaService,
  NoPlayableSourceErrorSchema,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { App } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { SUPER_ADMIN_ROLE } from '#/auth/constants.js'
import { createHouseholdFor } from '#/auth/server-helpers.js'
import { verifyTicket } from '#/auth/tickets.js'
import { user } from '#/db/schemas/auth.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaMovies,
  cinemaSeries,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamHouseholds, iamObjectClaims } from '#/db/schemas/iam.js'
import { RPC_PREFIX } from '#/routes.js'
import { createApp } from '#/server/app.js'
import { loadModules, type ModuleContext } from '#/server/modules.js'
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
import { startTestGateway, type TestGateway } from '#test/support/gateway.js'
import { iamClient } from '#test/support/rpc.js'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let database: TestDatabase
let gw: TestGateway
let ctx: ModuleContext
let app: Hono
let superAdmin: TestUser
let householdSuperAdmin: TestUser
let alice: TestUser
let bob: TestUser
let photosOnlyMember: TestUser
let homelessUser: TestUser
let nextTmdbId = 8000

function cinemaClient(
  headers?: Headers,
  options: { useHttpGet?: boolean } = {},
): Client<typeof CinemaService> {
  return createClient(
    CinemaService,
    createConnectTransport({
      baseUrl: `http://api.test${RPC_PREFIX}`,
      useHttpGet: options.useHttpGet ?? false,
      fetch: async (input, init) => app.request(new Request(input, init)),
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

function uniqueTmdbId(): number {
  nextTmdbId += 1
  return nextTmdbId
}

function movieRef(movieId: string) {
  return { target: { case: 'movieId' as const, value: movieId } }
}

function episodeRef(episodeId: string) {
  return { target: { case: 'episodeId' as const, value: episodeId } }
}

// Builds a synthetic ISO BMFF payload with a valid ftyp header and deterministic trailing bytes
// so byte-range assertions check exact offsets across the stored object.
function mediaBytes(
  majorBrand: string,
  compatibleBrands: string[],
  totalSize: number,
): Uint8Array {
  const boxSize = 16 + compatibleBrands.length * 4
  const buf = new Uint8Array(Math.max(totalSize, boxSize))
  const view = new DataView(buf.buffer)
  view.setUint32(0, boxSize, false)
  buf.set(Buffer.from('ftyp', 'ascii'), 4)
  buf.set(Buffer.from(majorBrand, 'ascii'), 8)
  compatibleBrands.forEach((brand, index) => {
    buf.set(Buffer.from(brand, 'ascii'), 16 + index * 4)
  })
  for (let i = boxSize; i < buf.length; i++) {
    buf[i] = (i * 31 + 17) & 0xff
  }
  return buf
}

async function insertMovie(
  overrides: Partial<typeof cinemaMovies.$inferInsert> = {},
) {
  const [row] = await database.db
    .insert(cinemaMovies)
    .values({
      tmdbId: uniqueTmdbId(),
      title: 'Arrival',
      releaseYear: 2016,
      runtimeMinutes: 116,
      ...overrides,
    })
    .returning()
  return row!
}

async function insertEpisode(
  overrides: Partial<typeof cinemaEpisodes.$inferInsert> = {},
) {
  const [series] = await database.db
    .insert(cinemaSeries)
    .values({
      tmdbId: uniqueTmdbId(),
      title: 'Andor',
      firstAirYear: 2022,
    })
    .returning()
  const [episode] = await database.db
    .insert(cinemaEpisodes)
    .values({
      seriesId: series!.id,
      tmdbId: uniqueTmdbId(),
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Kassa',
      runtimeMinutes: 42,
      ...overrides,
    })
    .returning()
  return { series: series!, episode: episode! }
}

// Uploads real bytes through the shared-library upload flow into the running Go Gateway,
// registers the file with AddMediaFile, and links it to a movie or episode.
async function uploadMatchedFile(options: {
  bytes: Uint8Array
  filename: string
  mimeType: string
  movieId?: string
  episodeId?: string
}) {
  const { reservationId, uploadTicket } = await iamClient(
    app,
    superAdmin.headers,
  ).prepareUpload({
    app: App.CINEMA,
    sizeBytes: BigInt(options.bytes.byteLength),
    sharedLibrary: true,
  })
  const uploaded = await new LumaVaultClient({ baseUrl: gw.baseUrl }).upload(
    options.bytes,
    {
      namespace: Namespace.CINEMA,
      filename: options.filename,
      mimeType: options.mimeType,
      ticket: uploadTicket,
    },
  )
  const { file } = await cinemaClient(superAdmin.headers).addMediaFile({
    reservationId,
    objectId: uploaded.id,
  })
  await database.db
    .update(cinemaMediaFiles)
    .set({
      movieId: options.movieId ?? null,
      episodeId: options.episodeId ?? null,
    })
    .where(eq(cinemaMediaFiles.id, file!.id))
  return { file: file!, objectId: uploaded.id }
}

async function attachClaimedFile(options: {
  movieId?: string
  episodeId?: string
  filename?: string
  container?: 'mp4' | 'mov'
  sizeBytes?: bigint
  releasedAt?: Date | null
}) {
  const objectId = `obj-${randomUUID()}`
  await database.db.insert(iamObjectClaims).values({
    objectId,
    app: 'cinema',
    bytes: options.sizeBytes ?? 4096n,
    releasedAt: options.releasedAt ?? null,
  })
  const [row] = await database.db
    .insert(cinemaMediaFiles)
    .values({
      objectId,
      filename: options.filename ?? 'movie.mp4',
      movieId: options.movieId ?? null,
      episodeId: options.episodeId ?? null,
      container: options.container ?? 'mp4',
    })
    .returning()
  return row!
}

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  gw = await startTestGateway()
  ctx = createTestContext(database, {
    env: { LUMAVAULT_GATEWAY_URL: gw.baseUrl },
  })
  app = createApp(ctx, await loadModules())

  superAdmin = await signUp(ctx, 'super@example.com')
  householdSuperAdmin = await signUp(ctx, 'hh-super@example.com')
  alice = await signUp(ctx, 'alice@example.com')
  bob = await signUp(ctx, 'bob@example.com')
  photosOnlyMember = await signUp(ctx, 'photos@example.com')
  homelessUser = await signUp(ctx, 'homeless@example.com')

  for (const admin of [superAdmin, householdSuperAdmin]) {
    await database.db
      .update(user)
      .set({ role: SUPER_ADMIN_ROLE })
      .where(eq(user.id, admin.id))
  }

  const cinemaHousehold = await createHouseholdFor(ctx, alice.id, 'Cinema Home')
  await database.db.insert(iamHouseholds).values({
    householdId: cinemaHousehold.id,
    enabledApps: ['cinema'],
  })
  await ctx.auth.api.addMember({
    body: {
      userId: bob.id,
      organizationId: cinemaHousehold.id,
      role: 'member',
    },
  })

  const photosHousehold = await createHouseholdFor(
    ctx,
    photosOnlyMember.id,
    'Photos Only',
  )
  await database.db.insert(iamHouseholds).values({
    householdId: photosHousehold.id,
    enabledApps: ['photos'],
  })
  await ctx.auth.api.addMember({
    body: {
      userId: householdSuperAdmin.id,
      organizationId: photosHousehold.id,
      role: 'member',
    },
  })
}, 120_000)

beforeEach(async () => {
  await database.db.delete(cinemaWatchProgress)
  await database.db.delete(cinemaMediaFiles)
  await database.db.delete(cinemaEpisodes)
  await database.db.delete(cinemaSeries)
  await database.db.delete(cinemaMovies)
  await database.db.delete(iamObjectClaims)
})

afterAll(async () => {
  gw?.stop()
  await database?.drop()
})

describe('Cinema access guard', () => {
  const calls: [
    string,
    (c: Client<typeof CinemaService>, movieId: string) => Promise<unknown>,
  ][] = [
    ['GetPlayback', (c, id) => c.getPlayback({ target: movieRef(id) })],
    ['GetDownload', (c, id) => c.getDownload({ target: movieRef(id) })],
  ]

  it.each(calls)('%s rejects unauthenticated callers', async (_name, call) => {
    const movie = await insertMovie()
    await attachClaimedFile({ movieId: movie.id })
    expect(await codeOf(call(cinemaClient(), movie.id))).toBe(
      Code.Unauthenticated,
    )
  })

  it.each(calls)(
    '%s refuses a household without Cinema turned on',
    async (_name, call) => {
      const movie = await insertMovie()
      await attachClaimedFile({ movieId: movie.id })
      expect(
        await codeOf(call(cinemaClient(photosOnlyMember.headers), movie.id)),
      ).toBe(Code.PermissionDenied)
    },
  )

  it.each(calls)(
    '%s refuses a regular user with no household',
    async (_name, call) => {
      const movie = await insertMovie()
      await attachClaimedFile({ movieId: movie.id })
      expect(
        await codeOf(call(cinemaClient(homelessUser.headers), movie.id)),
      ).toBe(Code.FailedPrecondition)
    },
  )

  it('allows household members with Cinema and Super-Admins with or without a Cinema household', async () => {
    const movie = await insertMovie()
    await attachClaimedFile({
      movieId: movie.id,
      filename: 'Arrival.mp4',
      sizeBytes: 2048n,
    })

    for (const caller of [bob, superAdmin, householdSuperAdmin]) {
      const client = cinemaClient(caller.headers)
      const playback = await client.getPlayback({ target: movieRef(movie.id) })
      expect(playback.sources).toHaveLength(1)
      const download = await client.getDownload({ target: movieRef(movie.id) })
      expect(download.filename).toBe('Arrival.mp4')
      expect(download.sizeBytes).toBe(2048n)
    }
  })
})

describe('target validation and missing files', () => {
  it('rejects unset, empty, or malformed targets with InvalidArgument', async () => {
    const client = cinemaClient(alice.headers)
    const badTargets = [
      undefined,
      { target: { case: undefined } },
      movieRef(''),
      movieRef('   '),
      movieRef('not-a-uuid'),
      episodeRef(''),
      episodeRef('not-a-uuid'),
    ]

    for (const target of badTargets) {
      expect(await codeOf(client.getPlayback({ target }))).toBe(
        Code.InvalidArgument,
      )
      expect(await codeOf(client.getDownload({ target }))).toBe(
        Code.InvalidArgument,
      )
    }
  })

  it('returns NotFound when the requested movie or episode does not exist', async () => {
    const client = cinemaClient(alice.headers)
    for (const target of [movieRef(randomUUID()), episodeRef(randomUUID())]) {
      const playbackErr = await catchConnectError(
        client.getPlayback({ target }),
      )
      expect(playbackErr?.code).toBe(Code.NotFound)
      expect(playbackErr?.findDetails(NoPlayableSourceErrorSchema)).toEqual([])

      expect(await codeOf(client.getDownload({ target }))).toBe(Code.NotFound)
    }
  })

  it('fails GetPlayback with FAILED_PRECONDITION and NoPlayableSourceError when a title has no files', async () => {
    const movie = await insertMovie({ title: 'No File Movie' })
    const { episode } = await insertEpisode({ title: 'No File Episode' })
    const client = cinemaClient(alice.headers)

    const movieErr = await catchConnectError(
      client.getPlayback({ target: movieRef(movie.id) }),
    )
    expect(movieErr?.code).toBe(Code.FailedPrecondition)
    const [movieDetail] = movieErr!.findDetails(NoPlayableSourceErrorSchema)
    expect(movieDetail?.target?.target).toEqual({
      case: 'movieId',
      value: movie.id,
    })

    const epErr = await catchConnectError(
      client.getPlayback({ target: episodeRef(episode.id) }),
    )
    expect(epErr?.code).toBe(Code.FailedPrecondition)
    const [epDetail] = epErr!.findDetails(NoPlayableSourceErrorSchema)
    expect(epDetail?.target?.target).toEqual({
      case: 'episodeId',
      value: episode.id,
    })

    expect(
      await codeOf(client.getDownload({ target: movieRef(movie.id) })),
    ).toBe(Code.NotFound)
    expect(
      await codeOf(client.getDownload({ target: episodeRef(episode.id) })),
    ).toBe(Code.NotFound)
  })

  it('treats a file whose object claim was released as unavailable', async () => {
    const movie = await insertMovie()
    await attachClaimedFile({
      movieId: movie.id,
      releasedAt: new Date(),
    })
    const client = cinemaClient(alice.headers)

    const err = await catchConnectError(
      client.getPlayback({ target: movieRef(movie.id) }),
    )
    expect(err?.code).toBe(Code.FailedPrecondition)
    const [detail] = err!.findDetails(NoPlayableSourceErrorSchema)
    expect(detail?.target?.target).toEqual({
      case: 'movieId',
      value: movie.id,
    })

    expect(
      await codeOf(client.getDownload({ target: movieRef(movie.id) })),
    ).toBe(Code.NotFound)
  })
})

describe('GetPlayback and GetDownload against a running Gateway', () => {
  it('streams MP4 movies with byte-range requests and serves attachment downloads', async () => {
    const movie = await insertMovie({ title: 'Arrival' })
    const payload = mediaBytes('isom', ['isom', 'iso2', 'avc1', 'mp41'], 16_384)
    const { objectId } = await uploadMatchedFile({
      bytes: payload,
      filename: 'Arrival (2016).mp4',
      mimeType: 'video/mp4',
      movieId: movie.id,
    })

    const client = cinemaClient(alice.headers)
    const playback = await client.getPlayback({ target: movieRef(movie.id) })
    expect(playback.resumePositionMs).toBe(0n)
    expect(playback.durationMs).toBe(0n)
    expect(playback.sources).toHaveLength(1)

    const source = playback.sources[0]!
    expect(source.mimeType).toBe('video/mp4')
    expect(source.expiresAt).toBeDefined()

    const streamParsed = new URL(source.url)
    expect(streamParsed.origin).toBe(gw.baseUrl)
    expect(streamParsed.pathname).toBe(`/v1/stream/${objectId}`)
    expect(streamParsed.searchParams.get('download')).toBeNull()
    const streamToken = streamParsed.searchParams.get('token')
    expect(streamToken).toBeTruthy()
    const streamClaims = verifyTicket(ctx.config.ticketSecret, streamToken!)
    expect(streamClaims).toMatchObject({ kind: 'rd', objectId })
    expect(timestampDate(source.expiresAt!).getTime()).toBe(
      streamClaims.exp * 1000,
    )

    // Unauthenticated stream request without the signed token is rejected by the Gateway.
    const unauthRes = await fetch(`${gw.baseUrl}/v1/stream/${objectId}`)
    expect(unauthRes.status).toBe(401)

    // Leading, middle, and suffix byte-range requests return HTTP 206 with exact bytes.
    const headRes = await fetch(source.url, {
      headers: { Range: 'bytes=0-1023' },
    })
    expect(headRes.status).toBe(206)
    expect(headRes.headers.get('accept-ranges')).toBe('bytes')
    expect(headRes.headers.get('content-type')).toBe('video/mp4')
    expect(headRes.headers.get('content-range')).toBe(
      `bytes 0-1023/${payload.byteLength}`,
    )
    expect(headRes.headers.get('content-length')).toBe('1024')
    expect(headRes.headers.get('content-disposition')).toBeNull()
    expect(new Uint8Array(await headRes.arrayBuffer())).toEqual(
      payload.subarray(0, 1024),
    )

    const midRes = await fetch(source.url, {
      headers: { Range: 'bytes=4096-8191' },
    })
    expect(midRes.status).toBe(206)
    expect(midRes.headers.get('content-range')).toBe(
      `bytes 4096-8191/${payload.byteLength}`,
    )
    expect(new Uint8Array(await midRes.arrayBuffer())).toEqual(
      payload.subarray(4096, 8192),
    )

    const tailRes = await fetch(source.url, {
      headers: { Range: 'bytes=-512' },
    })
    expect(tailRes.status).toBe(206)
    expect(tailRes.headers.get('content-range')).toBe(
      `bytes ${payload.byteLength - 512}-${payload.byteLength - 1}/${payload.byteLength}`,
    )
    expect(new Uint8Array(await tailRes.arrayBuffer())).toEqual(
      payload.subarray(payload.byteLength - 512),
    )

    // Signed download URL includes download=1 and serves a Content-Disposition attachment.
    const download = await client.getDownload({ target: movieRef(movie.id) })
    expect(download.filename).toBe('Arrival (2016).mp4')
    expect(download.sizeBytes).toBe(BigInt(payload.byteLength))
    expect(download.expiresAt).toBeDefined()

    const dlParsed = new URL(download.url)
    expect(dlParsed.origin).toBe(gw.baseUrl)
    expect(dlParsed.pathname).toBe(`/v1/stream/${objectId}`)
    expect(dlParsed.searchParams.get('download')).toBe('1')
    const dlToken = dlParsed.searchParams.get('token')
    expect(dlToken).toBeTruthy()
    const dlClaims = verifyTicket(ctx.config.ticketSecret, dlToken!)
    expect(dlClaims).toMatchObject({ kind: 'rd', objectId })
    expect(timestampDate(download.expiresAt!).getTime()).toBe(
      dlClaims.exp * 1000,
    )

    const dlRes = await fetch(download.url)
    expect(dlRes.status).toBe(200)
    const disposition = dlRes.headers.get('content-disposition')
    expect(disposition).toMatch(/^attachment\b/)
    expect(disposition).toContain('Arrival (2016).mp4')
    expect(dlRes.headers.get('content-length')).toBe(String(payload.byteLength))
    expect(new Uint8Array(await dlRes.arrayBuffer())).toEqual(payload)
  })

  it('serves QuickTime MOV episodes, ignores v1 PlaybackCapabilities, and supports HTTP GET', async () => {
    const { episode } = await insertEpisode({ title: 'Kassa' })
    const payload = mediaBytes('qt  ', ['qt  '], 8_192)
    await uploadMatchedFile({
      bytes: payload,
      filename: 'Andor.S01E01.mov',
      mimeType: 'video/quicktime',
      episodeId: episode.id,
    })

    const getClient = cinemaClient(alice.headers, { useHttpGet: true })
    const playback = await getClient.getPlayback({
      target: episodeRef(episode.id),
      capabilities: {
        videoCodecs: ['av1'],
        audioCodecs: ['opus'],
        containers: ['hls'],
        maxHeight: 720,
      },
    })
    expect(playback.sources).toHaveLength(1)
    expect(playback.sources[0]!.mimeType).toBe('video/quicktime')

    const rangeRes = await fetch(playback.sources[0]!.url, {
      headers: { Range: 'bytes=100-299' },
    })
    expect(rangeRes.status).toBe(206)
    expect(rangeRes.headers.get('content-type')).toBe('video/quicktime')
    expect(new Uint8Array(await rangeRes.arrayBuffer())).toEqual(
      payload.subarray(100, 300),
    )

    const download = await getClient.getDownload({
      target: episodeRef(episode.id),
    })
    expect(download.filename).toBe('Andor.S01E01.mov')
    expect(download.sizeBytes).toBe(BigInt(payload.byteLength))

    const dlRes = await fetch(download.url)
    expect(dlRes.status).toBe(200)
    expect(dlRes.headers.get('content-disposition')).toMatch(/^attachment\b/)
    expect(dlRes.headers.get('content-disposition')).toContain(
      'Andor.S01E01.mov',
    )
    expect(new Uint8Array(await dlRes.arrayBuffer())).toEqual(payload)
  })

  it('returns the claimed size_bytes from iam.object_claims for large files', async () => {
    const movie = await insertMovie()
    const largeSize = 53_687_091_200n
    await attachClaimedFile({
      movieId: movie.id,
      filename: 'Dune.4K.mp4',
      sizeBytes: largeSize,
    })

    const download = await cinemaClient(alice.headers).getDownload({
      target: movieRef(movie.id),
    })
    expect(download.filename).toBe('Dune.4K.mp4')
    expect(download.sizeBytes).toBe(largeSize)
  })
})

describe('resume position and duration', () => {
  it('returns saved resume position when in progress, zero when fresh or finished, and isolates per user', async () => {
    const movie = await insertMovie({ title: 'Interstellar' })
    await attachClaimedFile({ movieId: movie.id })

    const aliceClient = cinemaClient(alice.headers)
    const bobClient = cinemaClient(bob.headers)
    const target = movieRef(movie.id)

    // Starting fresh: zero resume position and unknown duration.
    const fresh = await aliceClient.getPlayback({ target })
    expect(fresh.resumePositionMs).toBe(0n)
    expect(fresh.durationMs).toBe(0n)

    // In progress below 95 percent: resumes at the saved position.
    await aliceClient.reportProgress({
      target,
      positionMs: 1_234_567n,
      durationMs: 10_140_000n,
    })
    const mid = await aliceClient.getPlayback({ target })
    expect(mid.resumePositionMs).toBe(1_234_567n)
    expect(mid.durationMs).toBe(10_140_000n)

    // Bob has independent progress and still starts from zero.
    const bobFresh = await bobClient.getPlayback({ target })
    expect(bobFresh.resumePositionMs).toBe(0n)
    expect(bobFresh.durationMs).toBe(0n)

    // Reaching 95 percent marks finished: resume resets to zero while duration stays known.
    await aliceClient.reportProgress({
      target,
      positionMs: 9_800_000n,
      durationMs: 10_140_000n,
    })
    const finished = await aliceClient.getPlayback({ target })
    expect(finished.resumePositionMs).toBe(0n)
    expect(finished.durationMs).toBe(10_140_000n)

    // Manually marking unwatched keeps duration and starts from zero.
    await aliceClient.setWatched({ target, watched: false })
    const unwatched = await aliceClient.getPlayback({ target })
    expect(unwatched.resumePositionMs).toBe(0n)
    expect(unwatched.durationMs).toBe(10_140_000n)

    // Manually marking watched also resumes from zero while keeping duration.
    await aliceClient.reportProgress({
      target,
      positionMs: 500_000n,
      durationMs: 10_140_000n,
    })
    await aliceClient.setWatched({ target, watched: true })
    const manuallyWatched = await aliceClient.getPlayback({ target })
    expect(manuallyWatched.resumePositionMs).toBe(0n)
    expect(manuallyWatched.durationMs).toBe(10_140_000n)
  })

  it('returns saved resume position and duration for episodes', async () => {
    const { episode } = await insertEpisode({ title: 'Aldhani' })
    await attachClaimedFile({
      episodeId: episode.id,
      filename: 'Andor.S01E04.mp4',
    })

    const aliceClient = cinemaClient(alice.headers)
    const target = episodeRef(episode.id)

    await aliceClient.reportProgress({
      target,
      positionMs: 600_000n,
      durationMs: 2_800_000n,
    })
    const mid = await aliceClient.getPlayback({ target })
    expect(mid.resumePositionMs).toBe(600_000n)
    expect(mid.durationMs).toBe(2_800_000n)

    await aliceClient.reportProgress({
      target,
      positionMs: 2_700_000n,
      durationMs: 2_800_000n,
    })
    const finished = await aliceClient.getPlayback({ target })
    expect(finished.resumePositionMs).toBe(0n)
    expect(finished.durationMs).toBe(2_800_000n)
  })
})
