import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DB_SCHEMAS } from '#/db/constants.js'
import { loadSchemaModules } from '#/db/index.js'
import { user } from '#/db/schemas/auth.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaMovies,
  cinemaSeries,
  cinemaWatchProgress,
} from '#/db/schemas/cinema.js'
import { iamObjectClaims } from '#/db/schemas/iam.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import { pushSchema } from 'drizzle-kit/api'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const API_DIR = fileURLToPath(new URL('../../', import.meta.url))

let database: TestDatabase
let nextTmdbId = 1000

function uniqueTmdbId(): number {
  nextTmdbId += 1
  return nextTmdbId
}

async function createUser(name = 'Ada'): Promise<string> {
  const id = randomUUID()
  await database.db
    .insert(user)
    .values({ id, name, email: `${id}@example.com` })
  return id
}

async function claimCinemaObject(bytes = 1024n): Promise<string> {
  const objectId = `obj-${randomUUID()}`
  await database.db
    .insert(iamObjectClaims)
    .values({ objectId, app: 'cinema', bytes })
  return objectId
}

async function createMovie(
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

async function createSeries(
  overrides: Partial<typeof cinemaSeries.$inferInsert> = {},
) {
  const [row] = await database.db
    .insert(cinemaSeries)
    .values({
      tmdbId: uniqueTmdbId(),
      title: 'Andor',
      firstAirYear: 2022,
      ...overrides,
    })
    .returning()
  return row!
}

async function createEpisode(
  seriesId: string,
  overrides: Partial<typeof cinemaEpisodes.$inferInsert> = {},
) {
  const [row] = await database.db
    .insert(cinemaEpisodes)
    .values({
      seriesId,
      tmdbId: uniqueTmdbId(),
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Kassa',
      runtimeMinutes: 42,
      airDate: '2022-09-21',
      ...overrides,
    })
    .returning()
  return row!
}

// Postgres reports constraint failures as error code 23xxx with the constraint name.
async function expectConstraint(
  promise: Promise<unknown>,
  constraint: string,
): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err, `expected ${constraint} to reject the write`).toBeDefined()
  const cause = (err as { cause?: { constraint?: string } }).cause
  expect(cause?.constraint).toBe(constraint)
}

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
})

afterAll(async () => {
  await database?.drop()
})

describe('catalog tables', () => {
  it('enforces one row per TMDB ID for movies, series, and episodes', async () => {
    const movie = await createMovie()
    await expectConstraint(
      createMovie({ tmdbId: movie.tmdbId }),
      'movies_tmdb_id_unique',
    )

    const series = await createSeries()
    await expectConstraint(
      createSeries({ tmdbId: series.tmdbId }),
      'series_tmdb_id_unique',
    )

    const episode = await createEpisode(series.id)
    await expectConstraint(
      createEpisode(series.id, {
        tmdbId: episode.tmdbId,
        episodeNumber: 2,
      }),
      'episodes_tmdb_id_unique',
    )
  })

  it('enforces unique season and episode numbers within a series and allows season 0 specials', async () => {
    const series = await createSeries()
    const special = await createEpisode(series.id, {
      seasonNumber: 0,
      episodeNumber: 1,
      title: 'Special',
    })
    expect(special.seasonNumber).toBe(0)

    await expectConstraint(
      createEpisode(series.id, { seasonNumber: 0, episodeNumber: 1 }),
      'episodes_series_season_episode_unique',
    )
    await expectConstraint(
      createEpisode(series.id, { seasonNumber: -1, episodeNumber: 1 }),
      'episodes_season_number_nonnegative',
    )
    await expectConstraint(
      createEpisode(series.id, { seasonNumber: 1, episodeNumber: 0 }),
      'episodes_episode_number_positive',
    )
  })

  it('stores art references against claimed IAM objects and rejects unknown object IDs', async () => {
    const posterObjectId = await claimCinemaObject(512n)
    const backdropObjectId = await claimCinemaObject(1024n)
    const stillObjectId = await claimCinemaObject(256n)

    const movie = await createMovie({
      posterPath: '/poster.jpg',
      backdropPath: '/backdrop.jpg',
      posterObjectId,
      backdropObjectId,
    })
    expect(movie.posterObjectId).toBe(posterObjectId)
    expect(movie.backdropObjectId).toBe(backdropObjectId)

    const series = await createSeries()
    const episode = await createEpisode(series.id, {
      stillPath: '/still.jpg',
      stillObjectId,
    })
    expect(episode.stillObjectId).toBe(stillObjectId)

    await expectConstraint(
      createMovie({ posterObjectId: 'unclaimed-object' }),
      'movies_poster_object_id_object_claims_object_id_fk',
    )
  })
})

describe('media files', () => {
  it('allows multiple unmatched originals and defaults kind to original', async () => {
    const first = await claimCinemaObject()
    const second = await claimCinemaObject()

    const [a] = await database.db
      .insert(cinemaMediaFiles)
      .values({ objectId: first, filename: 'Movie.A.mp4', container: 'mp4' })
      .returning()
    const [b] = await database.db
      .insert(cinemaMediaFiles)
      .values({ objectId: second, filename: 'Movie.B.mov', container: 'mov' })
      .returning()

    expect(a?.kind).toBe('original')
    expect(a?.movieId).toBeNull()
    expect(a?.episodeId).toBeNull()
    expect(b?.kind).toBe('original')
  })

  it('refuses a media file that points at both a movie and an episode', async () => {
    const movie = await createMovie()
    const series = await createSeries()
    const episode = await createEpisode(series.id)
    const objectId = await claimCinemaObject()

    await expectConstraint(
      database.db.insert(cinemaMediaFiles).values({
        objectId,
        filename: 'Both.mp4',
        movieId: movie.id,
        episodeId: episode.id,
        container: 'mp4',
      }),
      'media_files_at_most_one_target',
    )
  })

  it('refuses a second original for the same movie or episode', async () => {
    const movie = await createMovie()
    const firstMovieObj = await claimCinemaObject()
    const secondMovieObj = await claimCinemaObject()

    await database.db.insert(cinemaMediaFiles).values({
      objectId: firstMovieObj,
      filename: 'Arrival.mp4',
      movieId: movie.id,
      container: 'mp4',
    })
    await expectConstraint(
      database.db.insert(cinemaMediaFiles).values({
        objectId: secondMovieObj,
        filename: 'Arrival.2.mp4',
        movieId: movie.id,
        container: 'mp4',
      }),
      'media_files_one_original_per_movie',
    )

    const series = await createSeries()
    const episode = await createEpisode(series.id)
    const firstEpObj = await claimCinemaObject()
    const secondEpObj = await claimCinemaObject()

    await database.db.insert(cinemaMediaFiles).values({
      objectId: firstEpObj,
      filename: 'Andor.S01E01.mp4',
      episodeId: episode.id,
      container: 'mp4',
    })
    await expectConstraint(
      database.db.insert(cinemaMediaFiles).values({
        objectId: secondEpObj,
        filename: 'Andor.S01E01.v2.mov',
        episodeId: episode.id,
        container: 'mov',
      }),
      'media_files_one_original_per_episode',
    )
  })

  it('requires every media file object to exist in iam.object_claims and be unique', async () => {
    await expectConstraint(
      database.db.insert(cinemaMediaFiles).values({
        objectId: 'missing-claim',
        filename: 'Missing.mp4',
        container: 'mp4',
      }),
      'media_files_object_id_object_claims_object_id_fk',
    )

    const objectId = await claimCinemaObject()
    await database.db.insert(cinemaMediaFiles).values({
      objectId,
      filename: 'Once.mp4',
      container: 'mp4',
    })
    await expectConstraint(
      database.db.insert(cinemaMediaFiles).values({
        objectId,
        filename: 'Twice.mp4',
        container: 'mp4',
      }),
      'media_files_object_id_unique',
    )
  })
})

describe('watch progress', () => {
  it('enforces exactly one target and one row per person per item', async () => {
    const alice = await createUser('Alice')
    const bob = await createUser('Bob')
    const movie = await createMovie()
    const series = await createSeries()
    const episode = await createEpisode(series.id)

    await expectConstraint(
      database.db.insert(cinemaWatchProgress).values({ userId: alice }),
      'watch_progress_exactly_one_target',
    )
    await expectConstraint(
      database.db
        .insert(cinemaWatchProgress)
        .values({ userId: alice, movieId: movie.id, episodeId: episode.id }),
      'watch_progress_exactly_one_target',
    )

    const [movieProgress] = await database.db
      .insert(cinemaWatchProgress)
      .values({
        userId: alice,
        movieId: movie.id,
        positionMs: 120_000n,
        durationMs: 6_960_000n,
      })
      .returning()
    expect(movieProgress).toMatchObject({
      positionMs: 120_000n,
      durationMs: 6_960_000n,
      finished: false,
      watchCount: 0,
    })

    // Same user + same movie is refused, while another user succeeds.
    await expectConstraint(
      database.db
        .insert(cinemaWatchProgress)
        .values({ userId: alice, movieId: movie.id }),
      'watch_progress_user_movie_unique',
    )
    await database.db
      .insert(cinemaWatchProgress)
      .values({ userId: bob, movieId: movie.id })

    // Same rule for episodes.
    await database.db
      .insert(cinemaWatchProgress)
      .values({ userId: alice, episodeId: episode.id })
    await expectConstraint(
      database.db
        .insert(cinemaWatchProgress)
        .values({ userId: alice, episodeId: episode.id }),
      'watch_progress_user_episode_unique',
    )
    await database.db
      .insert(cinemaWatchProgress)
      .values({ userId: bob, episodeId: episode.id })
  })

  it('rejects negative position, duration, and watch counts', async () => {
    const userId = await createUser()
    for (const [field, constraint] of [
      ['positionMs', 'watch_progress_position_ms_nonnegative'],
      ['durationMs', 'watch_progress_duration_ms_nonnegative'],
      ['watchCount', 'watch_progress_watch_count_nonnegative'],
    ] as const) {
      const movie = await createMovie()
      await expectConstraint(
        database.db.insert(cinemaWatchProgress).values({
          userId,
          movieId: movie.id,
          [field]: field === 'watchCount' ? -1 : -1n,
        }),
        constraint,
      )
    }
  })
})

describe('deletes and unlinks', () => {
  it('deletes progress when a person is deleted', async () => {
    const userId = await createUser()
    const movie = await createMovie()
    await database.db
      .insert(cinemaWatchProgress)
      .values({ userId, movieId: movie.id, positionMs: 5000n })

    await database.db.delete(user).where(eq(user.id, userId))

    const remaining = await database.db
      .select()
      .from(cinemaWatchProgress)
      .where(eq(cinemaWatchProgress.userId, userId))
    expect(remaining).toEqual([])
  })

  it('deletes progress and unlinks files when a movie is deleted', async () => {
    const userId = await createUser()
    const movie = await createMovie()
    const objectId = await claimCinemaObject()
    const [file] = await database.db
      .insert(cinemaMediaFiles)
      .values({
        objectId,
        filename: 'DeleteMe.mp4',
        movieId: movie.id,
        container: 'mp4',
      })
      .returning()
    await database.db
      .insert(cinemaWatchProgress)
      .values({ userId, movieId: movie.id, positionMs: 1000n })

    await database.db.delete(cinemaMovies).where(eq(cinemaMovies.id, movie.id))

    const [unlinked] = await database.db
      .select()
      .from(cinemaMediaFiles)
      .where(eq(cinemaMediaFiles.id, file!.id))
    expect(unlinked?.movieId).toBeNull()
    expect(unlinked?.episodeId).toBeNull()

    const progress = await database.db
      .select()
      .from(cinemaWatchProgress)
      .where(eq(cinemaWatchProgress.movieId, movie.id))
    expect(progress).toEqual([])
  })

  it('deletes progress and unlinks files when an episode or series is deleted', async () => {
    const userId = await createUser()
    const series = await createSeries()
    const ep1 = await createEpisode(series.id, { episodeNumber: 1 })
    const ep2 = await createEpisode(series.id, { episodeNumber: 2 })
    const obj1 = await claimCinemaObject()
    const obj2 = await claimCinemaObject()

    const [file1] = await database.db
      .insert(cinemaMediaFiles)
      .values({
        objectId: obj1,
        filename: 'S01E01.mp4',
        episodeId: ep1.id,
        container: 'mp4',
      })
      .returning()
    const [file2] = await database.db
      .insert(cinemaMediaFiles)
      .values({
        objectId: obj2,
        filename: 'S01E02.mp4',
        episodeId: ep2.id,
        container: 'mp4',
      })
      .returning()
    await database.db.insert(cinemaWatchProgress).values([
      { userId, episodeId: ep1.id, positionMs: 1000n },
      { userId, episodeId: ep2.id, positionMs: 2000n },
    ])

    // Deleting a single episode removes its progress and unlinks its file.
    await database.db
      .delete(cinemaEpisodes)
      .where(eq(cinemaEpisodes.id, ep1.id))
    const [unlinked1] = await database.db
      .select()
      .from(cinemaMediaFiles)
      .where(eq(cinemaMediaFiles.id, file1!.id))
    expect(unlinked1?.episodeId).toBeNull()
    expect(
      await database.db
        .select()
        .from(cinemaWatchProgress)
        .where(eq(cinemaWatchProgress.episodeId, ep1.id)),
    ).toEqual([])

    // Deleting the parent series cascades through remaining episodes too.
    await database.db.delete(cinemaSeries).where(eq(cinemaSeries.id, series.id))
    const [unlinked2] = await database.db
      .select()
      .from(cinemaMediaFiles)
      .where(eq(cinemaMediaFiles.id, file2!.id))
    expect(unlinked2?.episodeId).toBeNull()
    expect(
      await database.db
        .select()
        .from(cinemaWatchProgress)
        .where(eq(cinemaWatchProgress.episodeId, ep2.id)),
    ).toEqual([])
  })
})

describe('db push', () => {
  it('finds nothing to change on a second push', async () => {
    const plan = await pushSchema(await loadSchemaModules(), database.db, [
      ...DB_SCHEMAS,
    ])
    expect(plan.statementsToExecute).toEqual([])
  })

  it('pushes cinema tables next to iam via pnpm db:push', async () => {
    const fresh = await createTestDatabase()
    try {
      await execFileAsync('pnpm', ['run', 'db:push', '--force'], {
        cwd: API_DIR,
        env: { ...process.env, DATABASE_URL: fresh.url, DB_SCHEMA: '' },
      })
      const res = await fresh.db.execute<{ table_name: string }>(sql`
        select table_name from information_schema.tables
        where table_schema = 'cinema'
        order by table_name
      `)
      expect(res.rows.map((r) => r.table_name)).toEqual([
        'episodes',
        'media_files',
        'movies',
        'series',
        'watch_progress',
      ])
    } finally {
      await fresh.drop()
    }
  }, 60_000)
})
