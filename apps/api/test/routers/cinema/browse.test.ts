import { randomUUID } from 'node:crypto'
import {
  Code,
  ConnectError,
  createClient,
  type Client,
} from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { CinemaService } from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { HOUSEHOLD_OWNER_ROLE, SUPER_ADMIN_ROLE } from '#/auth/constants.js'
import { createMember } from '#/data/auth/member/create-member.js'
import { createOrganization } from '#/data/auth/organization/create-organization.js'
import { createHousehold } from '#/data/iam/household/create-household.js'
import { user } from '#/db/schemas/auth.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaMovies,
  cinemaSeries,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import type { IamApp } from '#/iam/constants.js'
import { encodePageToken } from '#/lib/paging.js'
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
import { verifyTicket } from '#test/support/tickets.js'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let database: TestDatabase
let ctx: ModuleContext
let app: Hono
let alice: TestUser
let bob: TestUser
let photosOnlyUser: TestUser
let homelessUser: TestUser
let homelessSuperAdmin: TestUser
let nextTmdbId = 5000

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

async function codeOf(promise: Promise<unknown>): Promise<Code | 'ok'> {
  try {
    await promise
    return 'ok'
  } catch (err) {
    return ConnectError.from(err).code
  }
}

function uniqueTmdbId(): number {
  nextTmdbId += 1
  return nextTmdbId
}

async function makeUserInHousehold(
  email: string,
  householdName: string,
  enabledApps: IamApp[],
): Promise<TestUser> {
  const account = await signUp(ctx, email)
  const org = await createOrganization(ctx.db, {
    name: householdName,
    createdAt: new Date(),
  })
  await createMember(ctx.db, {
    organizationId: org.id,
    userId: account.id,
    role: HOUSEHOLD_OWNER_ROLE,
    createdAt: new Date(),
  })
  await createHousehold(ctx.db, {
    householdId: org.id,
    storageCapBytes: 10n * 2n ** 30n,
    enabledApps,
    memberLimit: 5,
  })
  return account
}

async function claimObject(
  options: { releasedAt?: Date } = {},
): Promise<string> {
  const objectId = `obj-${randomUUID()}`
  await ctx.db.insert(iamObjectClaims).values({
    objectId,
    app: 'cinema',
    bytes: 1024n,
    releasedAt: options.releasedAt ?? null,
  })
  return objectId
}

async function insertMovie(
  overrides: Partial<typeof cinemaMovies.$inferInsert> = {},
) {
  const [row] = await ctx.db
    .insert(cinemaMovies)
    .values({
      tmdbId: uniqueTmdbId(),
      title: 'Arrival',
      overview: 'A linguist works with the military.',
      releaseYear: 2016,
      runtimeMinutes: 116,
      ...overrides,
    })
    .returning()
  return row!
}

async function insertSeries(
  overrides: Partial<typeof cinemaSeries.$inferInsert> = {},
) {
  const [row] = await ctx.db
    .insert(cinemaSeries)
    .values({
      tmdbId: uniqueTmdbId(),
      title: 'Andor',
      overview: 'Rebel spy origin.',
      firstAirYear: 2022,
      ...overrides,
    })
    .returning()
  return row!
}

async function insertEpisode(
  seriesId: string,
  overrides: Partial<typeof cinemaEpisodes.$inferInsert> = {},
) {
  const [row] = await ctx.db
    .insert(cinemaEpisodes)
    .values({
      seriesId,
      tmdbId: uniqueTmdbId(),
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Kassa',
      overview: 'Cassian searches for his sister.',
      runtimeMinutes: 42,
      airDate: '2022-09-21',
      ...overrides,
    })
    .returning()
  return row!
}

async function attachFile(options: {
  movieId?: string
  episodeId?: string
  addedAt?: Date
  filename?: string
}) {
  const objectId = await claimObject()
  const [row] = await ctx.db
    .insert(cinemaMediaFiles)
    .values({
      objectId,
      filename: options.filename ?? 'video.mp4',
      movieId: options.movieId ?? null,
      episodeId: options.episodeId ?? null,
      container: 'mp4',
      addedAt: options.addedAt ?? new Date(),
    })
    .returning()
  return row!
}

async function setProgress(
  values: typeof cinemaWatchProgress.$inferInsert,
): Promise<void> {
  await ctx.db.insert(cinemaWatchProgress).values(values)
}

function expectSignedStreamUrl(url: string, expectedObjectId: string): void {
  const parsed = new URL(url)
  expect(parsed.origin).toBe(ctx.config.gatewayUrl)
  expect(parsed.pathname).toBe(`/v1/stream/${expectedObjectId}`)
  const token = parsed.searchParams.get('token')
  expect(token).toBeTruthy()
  const claims = verifyTicket(ctx.config.ticketSecret, token!)
  expect(claims).toMatchObject({ kind: 'rd', objectId: expectedObjectId })
}

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  ctx = createTestContext(database)
  app = createApp(ctx, await loadModules())

  alice = await makeUserInHousehold('alice@example.com', 'Alice Home', [
    'cinema',
  ])
  bob = await makeUserInHousehold('bob@example.com', 'Bob Home', [
    'photos',
    'cinema',
  ])
  photosOnlyUser = await makeUserInHousehold(
    'photos@example.com',
    'Photos Only',
    ['photos'],
  )
  homelessUser = await signUp(ctx, 'homeless@example.com')

  homelessSuperAdmin = await signUp(ctx, 'superadmin@example.com')
  await ctx.db
    .update(user)
    .set({ role: SUPER_ADMIN_ROLE })
    .where(eq(user.id, homelessSuperAdmin.id))
})

beforeEach(async () => {
  await ctx.db.delete(cinemaWatchProgress)
  await ctx.db.delete(cinemaMediaFiles)
  await ctx.db.delete(cinemaEpisodes)
  await ctx.db.delete(cinemaSeries)
  await ctx.db.delete(cinemaMovies)
  await ctx.db.delete(iamObjectClaims)
})

afterAll(async () => {
  await database.drop()
})

describe('Cinema access guard', () => {
  const calls: [
    string,
    (c: ReturnType<typeof cinemaClient>) => Promise<unknown>,
  ][] = [
    ['GetHome', (c) => c.getHome({})],
    ['ListMovies', (c) => c.listMovies({})],
    ['ListSeries', (c) => c.listSeries({})],
    ['GetMovie', (c) => c.getMovie({ movieId: randomUUID() })],
    ['GetSeries', (c) => c.getSeries({ seriesId: randomUUID() })],
  ]

  it.each(calls)('%s rejects unauthenticated callers', async (_name, call) => {
    expect(await codeOf(call(cinemaClient()))).toBe(Code.Unauthenticated)
  })

  it.each(calls)(
    '%s refuses a household without Cinema enabled',
    async (_name, call) => {
      expect(await codeOf(call(cinemaClient(photosOnlyUser.headers)))).toBe(
        Code.PermissionDenied,
      )
    },
  )

  it.each(calls)(
    '%s refuses a regular user with no household',
    async (_name, call) => {
      expect(await codeOf(call(cinemaClient(homelessUser.headers)))).toBe(
        Code.FailedPrecondition,
      )
    },
  )

  it('allows a Super-Admin with no household across browse RPCs', async () => {
    const movie = await insertMovie({ title: 'Dune' })
    await attachFile({ movieId: movie.id })
    const series = await insertSeries({ title: 'Severance' })
    const ep = await insertEpisode(series.id)
    await attachFile({ episodeId: ep.id })

    const admin = cinemaClient(homelessSuperAdmin.headers)
    const home = await admin.getHome({})
    expect(home.movies).toHaveLength(1)
    expect(home.series).toHaveLength(1)

    const movies = await admin.listMovies({})
    expect(movies.movies).toHaveLength(1)

    const listedSeries = await admin.listSeries({})
    expect(listedSeries.series).toHaveLength(1)

    const gotMovie = await admin.getMovie({ movieId: movie.id })
    expect(gotMovie.movie?.id).toBe(movie.id)

    const gotSeries = await admin.getSeries({ seriesId: series.id })
    expect(gotSeries.series?.id).toBe(series.id)
  })
})

describe('empty library and hidden unmatched or zero-file titles', () => {
  it('returns empty rows and empty heroes when the library is empty', async () => {
    const client = cinemaClient(alice.headers, { useHttpGet: true })
    const home = await client.getHome({})
    expect(home.heroes).toEqual([])
    expect(home.continueWatching).toEqual([])
    expect(home.recentlyAdded).toEqual([])
    expect(home.movies).toEqual([])
    expect(home.series).toEqual([])

    const movies = await client.listMovies({})
    expect(movies.movies).toEqual([])
    expect(movies.nextPageToken).toBe('')

    const series = await client.listSeries({})
    expect(series.series).toEqual([])
    expect(series.nextPageToken).toBe('')
  })

  it('hides unmatched files, zero-file movies, zero-file series, and zero-file episodes', async () => {
    // Unmatched media file.
    await attachFile({ filename: 'Unmatched.Movie.mp4' })

    // Movie with zero files.
    const emptyMovie = await insertMovie({ title: 'No File Movie' })

    // Series with episode metadata but zero media files.
    const emptySeries = await insertSeries({ title: 'No File Series' })
    await insertEpisode(emptySeries.id, { seasonNumber: 1, episodeNumber: 1 })

    // Playable series with one playable episode and one missing-file episode.
    const partialSeries = await insertSeries({ title: 'Partial Show' })
    const playableEp = await insertEpisode(partialSeries.id, {
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Available Ep',
    })
    const missingEp = await insertEpisode(partialSeries.id, {
      seasonNumber: 1,
      episodeNumber: 2,
      title: 'Missing File Ep',
    })
    await attachFile({ episodeId: playableEp.id })
    await setProgress({
      userId: alice.id,
      episodeId: missingEp.id,
      positionMs: 10_000n,
      durationMs: 20_000n,
      finished: true,
      watchCount: 1,
    })

    const client = cinemaClient(alice.headers)
    const home = await client.getHome({})
    expect(home.movies).toEqual([])
    expect(home.series.map((s) => s.id)).toEqual([partialSeries.id])
    expect(home.series[0]?.totalEpisodeCount).toBe(1)
    expect(home.series[0]?.watchedEpisodeCount).toBe(0)
    expect(home.heroes).toHaveLength(1)

    expect((await client.listMovies({})).movies).toEqual([])
    expect((await client.listSeries({})).series.map((s) => s.id)).toEqual([
      partialSeries.id,
    ])

    expect(await codeOf(client.getMovie({ movieId: emptyMovie.id }))).toBe(
      Code.NotFound,
    )
    expect(await codeOf(client.getMovie({ movieId: randomUUID() }))).toBe(
      Code.NotFound,
    )
    expect(await codeOf(client.getSeries({ seriesId: emptySeries.id }))).toBe(
      Code.NotFound,
    )
    expect(await codeOf(client.getSeries({ seriesId: randomUUID() }))).toBe(
      Code.NotFound,
    )
    expect(await codeOf(client.getMovie({ movieId: 'not-a-uuid' }))).toBe(
      Code.InvalidArgument,
    )
    expect(await codeOf(client.getSeries({ seriesId: 'not-a-uuid' }))).toBe(
      Code.InvalidArgument,
    )
    expect(await codeOf(client.getMovie({ movieId: '   ' }))).toBe(
      Code.InvalidArgument,
    )
    expect(await codeOf(client.getSeries({ seriesId: '' }))).toBe(
      Code.InvalidArgument,
    )

    const detail = await client.getSeries({ seriesId: partialSeries.id })
    expect(detail.series?.totalEpisodeCount).toBe(1)
    expect(detail.series?.watchedEpisodeCount).toBe(0)
    expect(detail.series?.seasons).toHaveLength(1)
    expect(detail.series?.seasons[0]?.episodes.map((e) => e.id)).toEqual([
      playableEp.id,
    ])
  })
})

describe('signed art URLs and no TMDB leakage', () => {
  it('signs active art objects into Gateway URLs, hides released or missing art, and never returns TMDB URLs', async () => {
    const posterObj = await claimObject()
    const releasedBackdropObj = await claimObject({ releasedAt: new Date() })
    const seriesPosterObj = await claimObject()
    const seriesBackdropObj = await claimObject()
    const stillObj = await claimObject()

    const movie = await insertMovie({
      title: 'Blade Runner 2049',
      posterPath: '/tmdb-poster.jpg',
      backdropPath: '/tmdb-backdrop.jpg',
      posterObjectId: posterObj,
      backdropObjectId: releasedBackdropObj,
    })
    await attachFile({ movieId: movie.id })

    const movieWithoutArt = await insertMovie({
      title: 'Pending Art Movie',
      posterPath: '/pending-poster.jpg',
      backdropPath: '/pending-backdrop.jpg',
    })
    await attachFile({ movieId: movieWithoutArt.id })

    const series = await insertSeries({
      title: 'Silo',
      posterPath: '/tmdb-series-poster.jpg',
      backdropPath: '/tmdb-series-backdrop.jpg',
      posterObjectId: seriesPosterObj,
      backdropObjectId: seriesBackdropObj,
    })
    const ep = await insertEpisode(series.id, {
      stillPath: '/tmdb-still.jpg',
      stillObjectId: stillObj,
    })
    await attachFile({ episodeId: ep.id })

    const client = cinemaClient(alice.headers)
    const gotMovie = await client.getMovie({ movieId: movie.id })
    expectSignedStreamUrl(gotMovie.movie!.posterUrl, posterObj)
    expect(gotMovie.movie!.backdropUrl).toBe('')

    const gotPending = await client.getMovie({ movieId: movieWithoutArt.id })
    expect(gotPending.movie!.posterUrl).toBe('')
    expect(gotPending.movie!.backdropUrl).toBe('')

    const gotSeries = await client.getSeries({ seriesId: series.id })
    expectSignedStreamUrl(gotSeries.series!.posterUrl, seriesPosterObj)
    expectSignedStreamUrl(gotSeries.series!.backdropUrl, seriesBackdropObj)
    expectSignedStreamUrl(
      gotSeries.series!.seasons[0]!.episodes[0]!.stillUrl,
      stillObj,
    )

    const home = await client.getHome({})
    const serialized = JSON.stringify(
      { home, gotMovie, gotPending, gotSeries },
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    )
    expect(serialized).not.toContain('tmdb.org')
    expect(serialized).not.toContain('themoviedb')
    expect(serialized).not.toContain('/tmdb-poster.jpg')
    expect(serialized).not.toContain('/tmdb-backdrop.jpg')
    expect(serialized).not.toContain('/tmdb-series-poster.jpg')
    expect(serialized).not.toContain('/tmdb-series-backdrop.jpg')
    expect(serialized).not.toContain('/pending-poster.jpg')
    expect(serialized).not.toContain('/pending-backdrop.jpg')
    expect(serialized).not.toContain('/tmdb-still.jpg')
  })
})

describe('GetHome heroes, recently added, and Continue Watching', () => {
  it('orders recently added by media file addedAt, caps heroes at 5, and isolates Continue Watching per user', async () => {
    const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes))

    // Create 6 playable titles so hero cap of 5 is exercised.
    const movies = []
    for (let i = 1; i <= 5; i += 1) {
      const m = await insertMovie({ title: `Movie ${i}` })
      await attachFile({ movieId: m.id, addedAt: t(i * 10) })
      movies.push(m)
    }

    const show = await insertSeries({ title: 'Andor' })
    const s1e1 = await insertEpisode(show.id, {
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'E1',
    })
    const s1e2 = await insertEpisode(show.id, {
      seasonNumber: 1,
      episodeNumber: 2,
      title: 'E2',
    })
    const s1e3Missing = await insertEpisode(show.id, {
      seasonNumber: 1,
      episodeNumber: 3,
      title: 'E3 Missing',
    })
    const s2e1 = await insertEpisode(show.id, {
      seasonNumber: 2,
      episodeNumber: 1,
      title: 'S2 E1',
    })
    await attachFile({ episodeId: s1e1.id, addedAt: t(5) })
    await attachFile({ episodeId: s1e2.id, addedAt: t(15) })
    // s1e3Missing intentionally has no file.
    await attachFile({ episodeId: s2e1.id, addedAt: t(60) })

    // Second show where Alice finished the finale (must not appear in Continue Watching).
    const finishedShow = await insertSeries({ title: 'Mini Series' })
    const onlyEp = await insertEpisode(finishedShow.id, {
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Finale',
    })
    await attachFile({ episodeId: onlyEp.id, addedAt: t(1) })

    // Alice: in-progress on Movie 1 at T=100, finished S1E2 of Andor at T=200 (queues S2E1,
    // skipping unavailable S1E3), finished Movie 2 at T=250 (excluded), finished Mini Series at T=300 (excluded).
    await setProgress({
      userId: alice.id,
      movieId: movies[0]!.id,
      positionMs: 90_000n,
      durationMs: 600_000n,
      finished: false,
      watchCount: 0,
      updatedAt: t(100),
    })
    await setProgress({
      userId: alice.id,
      movieId: movies[1]!.id,
      positionMs: 0n,
      durationMs: 600_000n,
      finished: true,
      watchCount: 1,
      updatedAt: t(250),
    })
    await setProgress({
      userId: alice.id,
      episodeId: s1e1.id,
      positionMs: 0n,
      durationMs: 2_400_000n,
      finished: true,
      watchCount: 1,
      updatedAt: t(50),
    })
    await setProgress({
      userId: alice.id,
      episodeId: s1e2.id,
      positionMs: 0n,
      durationMs: 2_400_000n,
      finished: true,
      watchCount: 1,
      updatedAt: t(200),
    })
    await setProgress({
      userId: alice.id,
      episodeId: onlyEp.id,
      positionMs: 0n,
      durationMs: 2_400_000n,
      finished: true,
      watchCount: 1,
      updatedAt: t(300),
    })

    // Bob: in-progress on S1E1 of Andor and Movie 3.
    await setProgress({
      userId: bob.id,
      episodeId: s1e1.id,
      positionMs: 45_000n,
      durationMs: 2_400_000n,
      finished: false,
      watchCount: 0,
      updatedAt: t(400),
    })
    await setProgress({
      userId: bob.id,
      movieId: movies[2]!.id,
      positionMs: 12_000n,
      durationMs: 600_000n,
      finished: false,
      watchCount: 0,
      updatedAt: t(350),
    })

    const aliceHome = await cinemaClient(alice.headers).getHome({})
    // Recently added: Andor (t60), Movie 5 (t50), Movie 4 (t40), Movie 3 (t30), Movie 2 (t20), Movie 1 (t10), Mini Series (t1).
    expect(
      aliceHome.recentlyAdded.map((c) =>
        c.item.case === 'movie' ? c.item.value.title : c.item.value?.title,
      ),
    ).toEqual([
      'Andor',
      'Movie 5',
      'Movie 4',
      'Movie 3',
      'Movie 2',
      'Movie 1',
      'Mini Series',
    ])
    expect(aliceHome.heroes).toHaveLength(5)
    expect(
      aliceHome.heroes.map((c) =>
        c.item.case === 'movie' ? c.item.value.title : c.item.value?.title,
      ),
    ).toEqual(['Andor', 'Movie 5', 'Movie 4', 'Movie 3', 'Movie 2'])

    // Alice's Continue Watching: S2E1 queued from finished S1E2 (t200), then Movie 1 (t100).
    expect(aliceHome.continueWatching).toHaveLength(2)
    const firstCw = aliceHome.continueWatching[0]!
    expect(firstCw.item.case).toBe('episode')
    if (firstCw.item.case === 'episode') {
      expect(firstCw.item.value.seriesId).toBe(show.id)
      expect(firstCw.item.value.seriesTitle).toBe('Andor')
      expect(firstCw.item.value.episode?.id).toBe(s2e1.id)
      expect(firstCw.item.value.episode?.id).not.toBe(s1e3Missing.id)
      expect(firstCw.item.value.episode?.progress).toBeUndefined()
    }
    expect(firstCw.progress).toBeUndefined()

    const secondCw = aliceHome.continueWatching[1]!
    expect(secondCw.item.case).toBe('movie')
    if (secondCw.item.case === 'movie') {
      expect(secondCw.item.value.id).toBe(movies[0]!.id)
    }
    expect(secondCw.progress?.positionMs).toBe(90_000n)

    // Series counts for Alice: Andor has 3 playable episodes, 2 watched.
    const aliceAndor = aliceHome.series.find((s) => s.id === show.id)
    expect(aliceAndor?.totalEpisodeCount).toBe(3)
    expect(aliceAndor?.watchedEpisodeCount).toBe(2)

    // Bob's Continue Watching only has Bob's own progress: S1E1 (t400), then Movie 3 (t350).
    const bobHome = await cinemaClient(bob.headers).getHome({})
    expect(bobHome.continueWatching).toHaveLength(2)
    expect(bobHome.continueWatching[0]?.item.case).toBe('episode')
    if (bobHome.continueWatching[0]?.item.case === 'episode') {
      expect(bobHome.continueWatching[0].item.value.episode?.id).toBe(s1e1.id)
    }
    expect(bobHome.continueWatching[0]?.progress?.positionMs).toBe(45_000n)

    expect(bobHome.continueWatching[1]?.item.case).toBe('movie')
    if (bobHome.continueWatching[1]?.item.case === 'movie') {
      expect(bobHome.continueWatching[1].item.value.id).toBe(movies[2]!.id)
    }
    expect(bobHome.continueWatching[1]?.progress?.positionMs).toBe(12_000n)

    // Bob has watched 0 episodes of Andor.
    const bobAndor = bobHome.series.find((s) => s.id === show.id)
    expect(bobAndor?.totalEpisodeCount).toBe(3)
    expect(bobAndor?.watchedEpisodeCount).toBe(0)
  })
})

describe('GetMovie and GetSeries detail', () => {
  it('returns movie metadata with caller progress and watchCount', async () => {
    const movie = await insertMovie({
      title: 'Interstellar',
      overview: 'Through the wormhole.',
      releaseYear: 2014,
      runtimeMinutes: 169,
    })
    await attachFile({ movieId: movie.id })
    await setProgress({
      userId: alice.id,
      movieId: movie.id,
      positionMs: 1_200_000n,
      durationMs: 10_140_000n,
      finished: false,
      watchCount: 2,
    })

    const aliceRes = await cinemaClient(alice.headers).getMovie({
      movieId: movie.id,
    })
    expect(aliceRes.movie).toMatchObject({
      id: movie.id,
      tmdbId: movie.tmdbId,
      title: 'Interstellar',
      overview: 'Through the wormhole.',
      releaseYear: 2014,
      runtimeMinutes: 169,
    })
    expect(aliceRes.movie?.progress).toMatchObject({
      positionMs: 1_200_000n,
      durationMs: 10_140_000n,
      finished: false,
      watchCount: 2,
    })

    const bobRes = await cinemaClient(bob.headers).getMovie({
      movieId: movie.id,
    })
    expect(bobRes.movie?.progress).toBeUndefined()
  })

  it('groups series episodes by season ascending and episode ascending with caller progress', async () => {
    const series = await insertSeries({
      title: 'The Expanse',
      firstAirYear: 2015,
    })
    // Insert episodes out of order across seasons 2, 1, and 0.
    const s2e2 = await insertEpisode(series.id, {
      seasonNumber: 2,
      episodeNumber: 2,
      title: 'Doors & Corners',
    })
    const s1e2 = await insertEpisode(series.id, {
      seasonNumber: 1,
      episodeNumber: 2,
      title: 'The Big Empty',
    })
    const s0e1 = await insertEpisode(series.id, {
      seasonNumber: 0,
      episodeNumber: 1,
      title: 'Special',
    })
    const s1e1 = await insertEpisode(series.id, {
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Dulcinea',
    })
    const s2e1 = await insertEpisode(series.id, {
      seasonNumber: 2,
      episodeNumber: 1,
      title: 'Safe',
    })

    for (const ep of [s2e2, s1e2, s0e1, s1e1, s2e1]) {
      await attachFile({ episodeId: ep.id })
    }

    await setProgress({
      userId: alice.id,
      episodeId: s1e1.id,
      positionMs: 0n,
      durationMs: 2_700_000n,
      finished: true,
      watchCount: 3,
    })
    await setProgress({
      userId: alice.id,
      episodeId: s1e2.id,
      positionMs: 500_000n,
      durationMs: 2_700_000n,
      finished: false,
      watchCount: 0,
    })

    const res = await cinemaClient(alice.headers).getSeries({
      seriesId: series.id,
    })
    expect(res.series?.totalEpisodeCount).toBe(5)
    expect(res.series?.watchedEpisodeCount).toBe(1)
    expect(res.series?.seasons.map((s) => s.seasonNumber)).toEqual([0, 1, 2])
    expect(res.series?.seasons[0]?.episodes.map((e) => e.id)).toEqual([s0e1.id])
    expect(res.series?.seasons[1]?.episodes.map((e) => e.id)).toEqual([
      s1e1.id,
      s1e2.id,
    ])
    expect(res.series?.seasons[2]?.episodes.map((e) => e.id)).toEqual([
      s2e1.id,
      s2e2.id,
    ])
    expect(res.series?.seasons[1]?.episodes[0]?.progress).toMatchObject({
      finished: true,
      watchCount: 3,
    })
    expect(res.series?.seasons[1]?.episodes[1]?.progress).toMatchObject({
      positionMs: 500_000n,
      finished: false,
    })
    expect(res.series?.seasons[2]?.episodes[0]?.progress).toBeUndefined()
  })
})

describe('ListMovies and ListSeries search and cursor pagination', () => {
  it('pages playable movies cleanly and filters case-insensitively with literal wildcards', async () => {
    const base = Date.UTC(2026, 2, 1, 0, 0, 0)
    const titles = ['Alien', 'Aliens', 'Dune', 'Dune: Part Two', '100% Wolf']
    for (let i = 0; i < titles.length; i += 1) {
      const m = await insertMovie({
        title: titles[i]!,
        createdAt: new Date(base + i * 1000),
      })
      await attachFile({ movieId: m.id })
    }
    // Unplayable match that must never appear.
    await insertMovie({ title: 'Dune: Unplayable' })

    const client = cinemaClient(alice.headers)
    const collected: string[] = []
    let pageToken = ''
    do {
      const page = await client.listMovies({ pageSize: 2, pageToken })
      collected.push(...page.movies.map((m) => m.title))
      pageToken = page.nextPageToken
    } while (pageToken)
    expect(collected).toEqual(titles)

    const duneSearch = await client.listMovies({ query: 'dUnE' })
    expect(duneSearch.movies.map((m) => m.title)).toEqual([
      'Dune',
      'Dune: Part Two',
    ])

    const percentSearch = await client.listMovies({ query: '100%' })
    expect(percentSearch.movies.map((m) => m.title)).toEqual(['100% Wolf'])

    expect(
      await codeOf(client.listMovies({ pageToken: 'not-valid-base64' })),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.listMovies({
          pageToken: encodePageToken({ createdAt: new Date(), id: 'not-uuid' }),
        }),
      ),
    ).toBe(Code.InvalidArgument)
  })

  it('pages playable series cleanly and filters case-insensitively', async () => {
    const base = Date.UTC(2026, 3, 1, 0, 0, 0)
    const titles = ['Dark', 'Dark Matter', 'Foundation', 'Severance']
    for (let i = 0; i < titles.length; i += 1) {
      const s = await insertSeries({
        title: titles[i]!,
        createdAt: new Date(base + i * 1000),
      })
      const ep = await insertEpisode(s.id)
      await attachFile({ episodeId: ep.id })
    }
    // Unplayable series that matches "dark".
    const unplayable = await insertSeries({ title: 'Dark Unplayable' })
    await insertEpisode(unplayable.id)

    const client = cinemaClient(alice.headers)
    const collected: string[] = []
    let pageToken = ''
    do {
      const page = await client.listSeries({ pageSize: 2, pageToken })
      collected.push(...page.series.map((s) => s.title))
      pageToken = page.nextPageToken
    } while (pageToken)
    expect(collected).toEqual(titles)

    const darkSearch = await client.listSeries({ query: 'DARK' })
    expect(darkSearch.series.map((s) => s.title)).toEqual([
      'Dark',
      'Dark Matter',
    ])

    expect(
      await codeOf(
        client.listSeries({
          pageToken: encodePageToken({ createdAt: new Date(), id: 'not-uuid' }),
        }),
      ),
    ).toBe(Code.InvalidArgument)
  })
})
