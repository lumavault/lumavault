import { randomUUID } from 'node:crypto'
import {
  Code,
  ConnectError,
  createClient,
  type Client,
} from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { CinemaService } from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { SUPER_ADMIN_ROLE } from '#/auth/constants.js'
import { createHouseholdFor } from '#/auth/server-helpers.js'
import { getWatchProgress } from '#/data/cinema/watch-progress/get-watch-progress.js'
import { user } from '#/db/schemas/auth.js'
import {
  cinemaEpisodes,
  cinemaMovies,
  cinemaSeries,
} from '#/db/schemas/cinema.js'
import { iamHouseholds } from '#/db/schemas/iam.js'
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
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let database: TestDatabase
let ctx: ModuleContext
let app: Hono
let alice: TestUser
let bob: TestUser
let noCinemaMember: TestUser
let outsider: TestUser
let loneSuperAdmin: TestUser
let householdSuperAdmin: TestUser
let nextTmdbId = 1000

function cinemaClient(headers?: Headers): Client<typeof CinemaService> {
  return createClient(
    CinemaService,
    createConnectTransport({
      baseUrl: `http://api.test${RPC_PREFIX}`,
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

async function createMovie(title = 'Arrival') {
  const [row] = await database.db
    .insert(cinemaMovies)
    .values({
      tmdbId: uniqueTmdbId(),
      title,
      releaseYear: 2016,
      runtimeMinutes: 116,
    })
    .returning()
  return row!
}

async function createEpisode(
  seriesId?: string,
  episodeNumber = 1,
  title = 'Kassa',
) {
  let targetSeriesId = seriesId
  if (!targetSeriesId) {
    const [series] = await database.db
      .insert(cinemaSeries)
      .values({
        tmdbId: uniqueTmdbId(),
        title: 'Andor',
        firstAirYear: 2022,
      })
      .returning()
    targetSeriesId = series!.id
  }
  const [episode] = await database.db
    .insert(cinemaEpisodes)
    .values({
      seriesId: targetSeriesId,
      tmdbId: uniqueTmdbId(),
      seasonNumber: 1,
      episodeNumber,
      title,
      runtimeMinutes: 42,
    })
    .returning()
  return { seriesId: targetSeriesId, episode: episode! }
}

function movieRef(movieId: string) {
  return { target: { case: 'movieId' as const, value: movieId } }
}

function episodeRef(episodeId: string) {
  return { target: { case: 'episodeId' as const, value: episodeId } }
}

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  ctx = createTestContext(database)
  app = createApp(ctx, await loadModules())

  alice = await signUp(ctx, 'alice@example.com')
  bob = await signUp(ctx, 'bob@example.com')
  noCinemaMember = await signUp(ctx, 'photos-only@example.com')
  outsider = await signUp(ctx, 'outsider@example.com')
  loneSuperAdmin = await signUp(ctx, 'lone-root@example.com')
  householdSuperAdmin = await signUp(ctx, 'household-root@example.com')

  for (const admin of [loneSuperAdmin, householdSuperAdmin]) {
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
    noCinemaMember.id,
    'Photos Home',
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
})

afterAll(async () => {
  await database?.drop()
})

describe('Cinema access guard', () => {
  it('enforces authentication, household membership, Cinema enablement, and Super-Admin access', async () => {
    const movie = await createMovie()
    const target = movieRef(movie.id)

    expect(
      await codeOf(
        cinemaClient().reportProgress({
          target,
          positionMs: 1000n,
          durationMs: 10_000n,
        }),
      ),
    ).toBe(Code.Unauthenticated)
    expect(
      await codeOf(cinemaClient().setWatched({ target, watched: true })),
    ).toBe(Code.Unauthenticated)

    expect(
      await codeOf(
        cinemaClient(outsider.headers).reportProgress({
          target,
          positionMs: 1000n,
          durationMs: 10_000n,
        }),
      ),
    ).toBe(Code.FailedPrecondition)
    expect(
      await codeOf(
        cinemaClient(outsider.headers).setWatched({ target, watched: true }),
      ),
    ).toBe(Code.FailedPrecondition)

    expect(
      await codeOf(
        cinemaClient(noCinemaMember.headers).reportProgress({
          target,
          positionMs: 1000n,
          durationMs: 10_000n,
        }),
      ),
    ).toBe(Code.PermissionDenied)
    expect(
      await codeOf(
        cinemaClient(noCinemaMember.headers).setWatched({
          target,
          watched: true,
        }),
      ),
    ).toBe(Code.PermissionDenied)

    const loneRes = await cinemaClient(loneSuperAdmin.headers).reportProgress({
      target,
      positionMs: 2000n,
      durationMs: 10_000n,
    })
    expect(loneRes.progress?.positionMs).toBe(2000n)

    const householdAdminRes = await cinemaClient(
      householdSuperAdmin.headers,
    ).setWatched({
      target,
      watched: true,
    })
    expect(householdAdminRes.progress?.finished).toBe(true)
  })
})

describe('target and value validation', () => {
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
      expect(
        await codeOf(
          client.reportProgress({
            target,
            positionMs: 1000n,
            durationMs: 10_000n,
          }),
        ),
      ).toBe(Code.InvalidArgument)
      expect(await codeOf(client.setWatched({ target, watched: true }))).toBe(
        Code.InvalidArgument,
      )
    }
  })

  it('returns NotFound when the referenced movie or episode does not exist', async () => {
    const client = cinemaClient(alice.headers)
    const missingMovie = movieRef(randomUUID())
    const missingEpisode = episodeRef(randomUUID())

    for (const target of [missingMovie, missingEpisode]) {
      expect(
        await codeOf(
          client.reportProgress({
            target,
            positionMs: 1000n,
            durationMs: 10_000n,
          }),
        ),
      ).toBe(Code.NotFound)
      expect(await codeOf(client.setWatched({ target, watched: true }))).toBe(
        Code.NotFound,
      )
    }
  })

  it('rejects out-of-range millisecond values and handles zero duration cleanly', async () => {
    const movie = await createMovie()
    const target = movieRef(movie.id)
    const client = cinemaClient(alice.headers)
    const tooLarge = 2n ** 63n

    expect(
      await codeOf(
        client.reportProgress({
          target,
          positionMs: tooLarge,
          durationMs: 10_000n,
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.reportProgress({
          target,
          positionMs: 1000n,
          durationMs: tooLarge,
        }),
      ),
    ).toBe(Code.InvalidArgument)

    const zeroDuration = await client.reportProgress({
      target,
      positionMs: 5000n,
      durationMs: 0n,
    })
    expect(zeroDuration.progress).toMatchObject({
      positionMs: 5000n,
      durationMs: 0n,
      finished: false,
      watchCount: 0,
    })
  })
})

describe('ReportProgress', () => {
  it('shares progress across sessions of the same person and isolates other users', async () => {
    const movie = await createMovie('Dune')
    const target = movieRef(movie.id)

    const secondSignIn = await ctx.auth.api.signInEmail({
      body: { email: alice.email, password: 'correct horse battery' },
    })
    const aliceSession2Headers = new Headers({
      authorization: `Bearer ${secondSignIn.token}`,
    })
    expect(aliceSession2Headers.get('authorization')).not.toBe(
      alice.headers.get('authorization'),
    )

    const first = await cinemaClient(alice.headers).reportProgress({
      target,
      positionMs: 30_000n,
      durationMs: 100_000n,
    })
    expect(first.progress).toMatchObject({
      positionMs: 30_000n,
      durationMs: 100_000n,
      finished: false,
      watchCount: 0,
    })
    expect(first.progress?.updatedAt).toBeDefined()

    const storedAfterSession1 = await getWatchProgress(database.db, alice.id, {
      kind: 'movie',
      id: movie.id,
    })
    expect(storedAfterSession1).toMatchObject({
      positionMs: 30_000n,
      durationMs: 100_000n,
      finished: false,
      watchCount: 0,
    })

    // Session 2 of the same user continues and updates the same row (latest report wins).
    const second = await cinemaClient(aliceSession2Headers).reportProgress({
      target,
      positionMs: 96_000n,
      durationMs: 100_000n,
    })
    expect(second.progress).toMatchObject({
      positionMs: 96_000n,
      durationMs: 100_000n,
      finished: true,
      watchCount: 1,
    })

    // Session 1 sending a later report at 97s sees the finished state from session 2 and does not double-count.
    const third = await cinemaClient(alice.headers).reportProgress({
      target,
      positionMs: 97_000n,
      durationMs: 100_000n,
    })
    expect(third.progress).toMatchObject({
      positionMs: 97_000n,
      durationMs: 100_000n,
      finished: true,
      watchCount: 1,
    })

    // Another user in the same household has completely independent progress.
    expect(
      await getWatchProgress(database.db, bob.id, {
        kind: 'movie',
        id: movie.id,
      }),
    ).toBeNull()
    const bobRes = await cinemaClient(bob.headers).reportProgress({
      target,
      positionMs: 12_000n,
      durationMs: 100_000n,
    })
    expect(bobRes.progress).toMatchObject({
      positionMs: 12_000n,
      durationMs: 100_000n,
      finished: false,
      watchCount: 0,
    })

    const aliceRow = await getWatchProgress(database.db, alice.id, {
      kind: 'movie',
      id: movie.id,
    })
    expect(aliceRow?.positionMs).toBe(97_000n)
    expect(aliceRow?.watchCount).toBe(1)
  })

  it('marks finished at 95 percent, avoids double-counting, and counts rewatches', async () => {
    const { episode } = await createEpisode()
    const target = episodeRef(episode.id)
    const client = cinemaClient(alice.headers)

    const below = await client.reportProgress({
      target,
      positionMs: 94_999n,
      durationMs: 100_000n,
    })
    expect(below.progress).toMatchObject({
      positionMs: 94_999n,
      finished: false,
      watchCount: 0,
    })

    const exact = await client.reportProgress({
      target,
      positionMs: 95_000n,
      durationMs: 100_000n,
    })
    expect(exact.progress).toMatchObject({
      positionMs: 95_000n,
      finished: true,
      watchCount: 1,
    })

    // Repeated heartbeats above 95 percent do not double-count.
    for (const positionMs of [96_000n, 98_500n, 100_000n]) {
      const heartbeat = await client.reportProgress({
        target,
        positionMs,
        durationMs: 100_000n,
      })
      expect(heartbeat.progress).toMatchObject({
        positionMs,
        finished: true,
        watchCount: 1,
      })
    }

    // Rewatching from below 95 percent clears finished while keeping watchCount, and crossing 95 percent increments it.
    const rewatchStart = await client.reportProgress({
      target,
      positionMs: 15_000n,
      durationMs: 100_000n,
    })
    expect(rewatchStart.progress).toMatchObject({
      positionMs: 15_000n,
      finished: false,
      watchCount: 1,
    })

    const rewatchEnd = await client.reportProgress({
      target,
      positionMs: 95_000n,
      durationMs: 100_000n,
    })
    expect(rewatchEnd.progress).toMatchObject({
      positionMs: 95_000n,
      finished: true,
      watchCount: 2,
    })
  })

  it('counts a first-ever report at 95 percent or higher as one completion', async () => {
    const movie = await createMovie('Interstellar')
    const client = cinemaClient(alice.headers)

    const res = await client.reportProgress({
      target: movieRef(movie.id),
      positionMs: 95_000n,
      durationMs: 100_000n,
    })
    expect(res.progress).toMatchObject({
      positionMs: 95_000n,
      durationMs: 100_000n,
      finished: true,
      watchCount: 1,
    })
  })

  it('increments watch_count once when concurrent reports cross 95 percent', async () => {
    const movie = await createMovie('Blade Runner 2049')
    const target = movieRef(movie.id)
    const client = cinemaClient(alice.headers)

    await client.reportProgress({
      target,
      positionMs: 50_000n,
      durationMs: 100_000n,
    })

    await Promise.all([
      client.reportProgress({
        target,
        positionMs: 95_000n,
        durationMs: 100_000n,
      }),
      client.reportProgress({
        target,
        positionMs: 96_000n,
        durationMs: 100_000n,
      }),
      client.reportProgress({
        target,
        positionMs: 97_000n,
        durationMs: 100_000n,
      }),
    ])

    const row = await getWatchProgress(database.db, alice.id, {
      kind: 'movie',
      id: movie.id,
    })
    expect(row).toMatchObject({
      finished: true,
      watchCount: 1,
    })
  })
})

describe('SetWatched', () => {
  it('toggles watched and unwatched on movies while preserving duration and watch history', async () => {
    const movie = await createMovie('Heat')
    const target = movieRef(movie.id)
    const client = cinemaClient(alice.headers)

    await client.reportProgress({
      target,
      positionMs: 45_000n,
      durationMs: 120_000n,
    })

    const watched = await client.setWatched({ target, watched: true })
    expect(watched.progress).toMatchObject({
      positionMs: 0n,
      durationMs: 120_000n,
      finished: true,
      watchCount: 1,
    })
    expect(watched.progress?.updatedAt).toBeDefined()

    // Marking watched again while already finished stays idempotent.
    const watchedAgain = await client.setWatched({ target, watched: true })
    expect(watchedAgain.progress).toMatchObject({
      positionMs: 0n,
      durationMs: 120_000n,
      finished: true,
      watchCount: 1,
    })

    // Marking unwatched clears finished and positionMs while keeping durationMs and watchCount.
    const unwatched = await client.setWatched({ target, watched: false })
    expect(unwatched.progress).toMatchObject({
      positionMs: 0n,
      durationMs: 120_000n,
      finished: false,
      watchCount: 1,
    })

    // Marking watched again from unfinished increments watchCount.
    const rewatched = await client.setWatched({ target, watched: true })
    expect(rewatched.progress).toMatchObject({
      positionMs: 0n,
      durationMs: 120_000n,
      finished: true,
      watchCount: 2,
    })
  })

  it('toggles watched and unwatched on episodes independently', async () => {
    const { seriesId, episode: ep1 } = await createEpisode(
      undefined,
      1,
      'Pilot',
    )
    const { episode: ep2 } = await createEpisode(seriesId, 2, 'Second')
    const client = cinemaClient(alice.headers)

    const ep1Watched = await client.setWatched({
      target: episodeRef(ep1.id),
      watched: true,
    })
    expect(ep1Watched.progress).toMatchObject({
      positionMs: 0n,
      durationMs: 0n,
      finished: true,
      watchCount: 1,
    })

    expect(
      await getWatchProgress(database.db, alice.id, {
        kind: 'episode',
        id: ep2.id,
      }),
    ).toBeNull()

    const ep1Unwatched = await client.setWatched({
      target: episodeRef(ep1.id),
      watched: false,
    })
    expect(ep1Unwatched.progress).toMatchObject({
      positionMs: 0n,
      durationMs: 0n,
      finished: false,
      watchCount: 1,
    })

    // Marking an unseen episode unwatched succeeds cleanly with zero watchCount.
    const ep2Unwatched = await client.setWatched({
      target: episodeRef(ep2.id),
      watched: false,
    })
    expect(ep2Unwatched.progress).toMatchObject({
      positionMs: 0n,
      durationMs: 0n,
      finished: false,
      watchCount: 0,
    })
  })
})
