import { randomUUID } from 'node:crypto'
import {
  Code,
  ConnectError,
  createClient,
  type Client,
} from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import {
  CinemaService,
  MediaContainer,
  MediaFileFilter,
  MediaFileKind,
  UnsupportedMediaFormatErrorSchema,
} from '@lumavault/sdk/gen/lumavault/cinema/v1/cinema_pb'
import { App } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { SUPER_ADMIN_ROLE } from '#/auth/constants.js'
import { createHouseholdFor } from '#/auth/server-helpers.js'
import { getMediaFileById } from '#/data/cinema/media-file/get-media-file.js'
import { user } from '#/db/schemas/auth.js'
import {
  cinemaEpisodes,
  cinemaMediaFiles,
  cinemaMovies,
  cinemaSeries,
} from '#/db/schemas/cinema.js'
import { iamHouseholds, iamObjectClaims } from '#/db/schemas/iam.js'
import { MAX_PAGE_SIZE } from '#/lib/constants.js'
import type {
  StorageGateway,
  StoredObject,
  UploadObjectInput,
} from '#/lib/storage-gateway.js'
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
import { iamClient } from '#test/support/rpc.js'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

interface FakeObject {
  stored: StoredObject
  data: Uint8Array
}

class FakeGateway implements StorageGateway {
  objects = new Map<string, FakeObject>()
  deleted: string[] = []

  commit(options: {
    app?: 'photos' | 'cinema' | 'arcade'
    filename?: string
    data: Uint8Array
    sizeBytes?: bigint
  }): string {
    const id = randomUUID()
    const app = options.app ?? 'cinema'
    this.objects.set(id, {
      stored: {
        id,
        namespace: APP_NAMESPACE[app],
        sizeBytes: options.sizeBytes ?? BigInt(options.data.byteLength),
        sha256Digest: '0'.repeat(64),
        mimeType: '',
        filename: options.filename ?? '',
      },
      data: options.data,
    })
    return id
  }

  async stat(objectId: string): Promise<StoredObject | null> {
    return this.objects.get(objectId)?.stored ?? null
  }

  async readHead(
    objectId: string,
    maxBytes: number,
  ): Promise<Uint8Array | null> {
    const entry = this.objects.get(objectId)
    if (!entry) {
      return null
    }
    return entry.data.subarray(0, maxBytes)
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
    this.objects.set(id, { stored, data: input.bytes })
    return stored
  }

  async delete(objectId: string): Promise<void> {
    this.deleted.push(objectId)
    this.objects.delete(objectId)
  }

  async setThumbnail(): Promise<void> {}
}

function cinemaClient(
  app: Hono,
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

function ftypBytes(
  majorBrand: string,
  compatibleBrands: string[] = [],
  minorVersion = 0,
): Uint8Array {
  const size = 16 + compatibleBrands.length * 4
  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  view.setUint32(0, size, false)
  buf.set(Buffer.from('ftyp', 'ascii'), 4)
  buf.set(Buffer.from(majorBrand, 'ascii'), 8)
  view.setUint32(12, minorVersion, false)
  compatibleBrands.forEach((brand, index) => {
    buf.set(Buffer.from(brand, 'ascii'), 16 + index * 4)
  })
  return buf
}

function ebmlBytes(docType: string): Uint8Array {
  const docTypeBytes = Buffer.from(docType, 'ascii')
  return Uint8Array.from([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x9f,
    0x42,
    0x82,
    0x80 | docTypeBytes.length,
    ...docTypeBytes,
  ])
}

function aviBytes(): Uint8Array {
  const buf = new Uint8Array(16)
  buf.set(Buffer.from('RIFF', 'ascii'), 0)
  buf.set(Buffer.from('AVI ', 'ascii'), 8)
  return buf
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

let database: TestDatabase
let gateway: FakeGateway
let ctx: ModuleContext
let app: Hono
let superAdmin: TestUser
let otherSuperAdmin: TestUser
let householdOwner: TestUser
let householdMember: TestUser
let householdId: string

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  gateway = new FakeGateway()
  ctx = createTestContext(database, { gateway })
  app = createApp(ctx, await loadModules())

  superAdmin = await signUp(ctx, 'super@example.com')
  otherSuperAdmin = await signUp(ctx, 'super2@example.com')
  householdOwner = await signUp(ctx, 'owner@example.com')
  householdMember = await signUp(ctx, 'member@example.com')

  await database.db
    .update(user)
    .set({ role: SUPER_ADMIN_ROLE })
    .where(eq(user.id, superAdmin.id))
  await database.db
    .update(user)
    .set({ role: SUPER_ADMIN_ROLE })
    .where(eq(user.id, otherSuperAdmin.id))

  householdId = (await createHouseholdFor(ctx, householdOwner.id, 'Home')).id
  await database.db.insert(iamHouseholds).values({
    householdId,
    storageCapBytes: 10_000n,
    enabledApps: ['cinema', 'photos'],
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
  await database.db.delete(cinemaMediaFiles)
  await database.db.delete(cinemaEpisodes)
  await database.db.delete(cinemaSeries)
  await database.db.delete(cinemaMovies)
  gateway.objects.clear()
  gateway.deleted = []
})

afterAll(async () => {
  await database?.drop()
})

async function prepareSharedCinemaUpload(
  caller: TestUser,
  data: Uint8Array,
  options: {
    filename?: string
    sizeBytes?: bigint
    reserveBytes?: bigint
  } = {},
) {
  const actualSize = options.sizeBytes ?? BigInt(data.byteLength)
  const reserveSize =
    options.reserveBytes ?? (actualSize > 0n ? actualSize : 64n)
  const { reservationId } = await iamClient(app, caller.headers).prepareUpload({
    app: App.CINEMA,
    sizeBytes: reserveSize,
    sharedLibrary: true,
  })
  const objectId = gateway.commit({
    app: 'cinema',
    filename: options.filename ?? 'movie.mp4',
    data,
    sizeBytes: actualSize,
  })
  return { reservationId, objectId }
}

describe('Super-Admin access', () => {
  const calls: [
    string,
    (client: Client<typeof CinemaService>) => Promise<unknown>,
  ][] = [
    [
      'AddMediaFile',
      (c) => c.addMediaFile({ reservationId: randomUUID(), objectId: 'obj-1' }),
    ],
    ['ListMediaFiles', (c) => c.listMediaFiles({})],
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
})

describe('AddMediaFile', () => {
  it('adds MP4 and QuickTime MOV files and lists them with filename, container, and size', async () => {
    const mp4Upload = await prepareSharedCinemaUpload(
      superAdmin,
      ftypBytes('isom', ['isom', 'iso2', 'avc1', 'mp41'], 512),
      { filename: 'Dune.Part.Two.2024.mp4', sizeBytes: 4_200_000_000n },
    )
    const movUpload = await prepareSharedCinemaUpload(
      superAdmin,
      ftypBytes('qt  ', ['qt  ']),
      { filename: 'Home.Movie.mov', sizeBytes: 980_000_000n },
    )

    const client = cinemaClient(app, superAdmin.headers)
    const mp4Res = await client.addMediaFile(mp4Upload)
    const movRes = await client.addMediaFile(movUpload)

    expect(mp4Res.file).toMatchObject({
      objectId: mp4Upload.objectId,
      filename: 'Dune.Part.Two.2024.mp4',
      sizeBytes: 4_200_000_000n,
      kind: MediaFileKind.ORIGINAL,
      container: MediaContainer.MP4,
      match: { case: undefined },
    })
    expect(mp4Res.file!.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(mp4Res.file!.addedAt).toBeDefined()

    expect(movRes.file).toMatchObject({
      objectId: movUpload.objectId,
      filename: 'Home.Movie.mov',
      sizeBytes: 980_000_000n,
      kind: MediaFileKind.ORIGINAL,
      container: MediaContainer.MOV,
      match: { case: undefined },
    })

    const listed = await client.listMediaFiles({})
    expect(listed.files.map((f) => f.id)).toEqual([
      mp4Res.file!.id,
      movRes.file!.id,
    ])
    expect(listed.files.map((f) => f.container)).toEqual([
      MediaContainer.MP4,
      MediaContainer.MOV,
    ])
    expect(listed.files.map((f) => f.sizeBytes)).toEqual([
      4_200_000_000n,
      980_000_000n,
    ])

    const byId = await getMediaFileById(database.db, mp4Res.file!.id)
    expect(byId?.file.filename).toBe('Dune.Part.Two.2024.mp4')
    expect(await getMediaFileById(database.db, 'not-a-uuid')).toBeNull()
  })

  it('recognizes MP4 files with a vendor major brand and mp42 compatible brand', async () => {
    const upload = await prepareSharedCinemaUpload(
      superAdmin,
      ftypBytes('XAVC', ['XAVC', 'mp42', 'iso2']),
      { filename: 'camera.mp4', sizeBytes: 512n },
    )
    const res = await cinemaClient(app, superAdmin.headers).addMediaFile(upload)
    expect(res.file?.container).toBe(MediaContainer.MP4)
  })

  it('is idempotent when called again with the same reservation and object', async () => {
    const upload = await prepareSharedCinemaUpload(
      superAdmin,
      ftypBytes('mp42', ['mp42', 'isom']),
      { filename: 'retry.mp4', sizeBytes: 128n },
    )
    const client = cinemaClient(app, superAdmin.headers)
    const first = await client.addMediaFile(upload)
    const second = await client.addMediaFile(upload)
    expect(second.file).toEqual(first.file)
  })

  it('rejects an MKV renamed to .mp4 with UnsupportedMediaFormatError and deletes it from the Gateway', async () => {
    const upload = await prepareSharedCinemaUpload(
      superAdmin,
      ebmlBytes('matroska'),
      { filename: 'Inception.2010.mp4', sizeBytes: 1024n },
    )
    const err = await catchConnectError(
      cinemaClient(app, superAdmin.headers).addMediaFile(upload),
    )

    expect(err).not.toBeNull()
    expect(err!.code).toBe(Code.InvalidArgument)
    const [detail] = err!.findDetails(UnsupportedMediaFormatErrorSchema)
    expect(detail).toMatchObject({
      detectedFormat: 'video/x-matroska',
      supportedContainers: [MediaContainer.MP4, MediaContainer.MOV],
    })

    expect(gateway.deleted).toContain(upload.objectId)
    expect(gateway.objects.has(upload.objectId)).toBe(false)

    const [claim] = await database.db
      .select()
      .from(iamObjectClaims)
      .where(eq(iamObjectClaims.objectId, upload.objectId))
    expect(claim?.releasedAt).not.toBeNull()

    const rows = await database.db.select().from(cinemaMediaFiles)
    expect(rows).toHaveLength(0)
  })

  it.each([
    ['WebM', ebmlBytes('webm'), 'video/webm'],
    ['AVI', aviBytes(), 'video/x-msvideo'],
    ['HEIC image', ftypBytes('heic', ['mif1', 'heic']), 'image/heic'],
    [
      'random bytes',
      Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6, 7, 8]),
      '',
    ],
    ['empty file', new Uint8Array(0), ''],
  ])(
    'rejects %s renamed to .mp4 and releases the object',
    async (_label, bytes, expectedFormat) => {
      const upload = await prepareSharedCinemaUpload(superAdmin, bytes, {
        filename: 'fake.mp4',
        sizeBytes: BigInt(bytes.byteLength),
        reserveBytes: 256n,
      })
      const err = await catchConnectError(
        cinemaClient(app, superAdmin.headers).addMediaFile(upload),
      )

      expect(err?.code).toBe(Code.InvalidArgument)
      const [detail] = err!.findDetails(UnsupportedMediaFormatErrorSchema)
      expect(detail).toMatchObject({
        detectedFormat: expectedFormat,
        supportedContainers: [MediaContainer.MP4, MediaContainer.MOV],
      })
      expect(gateway.objects.has(upload.objectId)).toBe(false)
    },
  )

  it('rejects bad IDs, wrong reservations, and non-shared-library uploads', async () => {
    const client = cinemaClient(app, superAdmin.headers)
    const mp4 = ftypBytes('isom', ['isom'])

    expect(
      await codeOf(client.addMediaFile({ reservationId: '', objectId: 'obj' })),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.addMediaFile({ reservationId: 'not-a-uuid', objectId: 'obj' }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.addMediaFile({ reservationId: randomUUID(), objectId: '' }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.addMediaFile({
          reservationId: randomUUID(),
          objectId: '../escape',
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        client.addMediaFile({
          reservationId: randomUUID(),
          objectId: randomUUID(),
        }),
      ),
    ).toBe(Code.NotFound)

    // Reservation belonging to a different Super-Admin.
    const otherUpload = await prepareSharedCinemaUpload(otherSuperAdmin, mp4)
    expect(await codeOf(client.addMediaFile(otherUpload))).toBe(
      Code.PermissionDenied,
    )

    // Household-billed Cinema reservation is refused without modifying household bytes.
    const householdRes = await iamClient(app, superAdmin.headers).prepareUpload(
      {
        app: App.CINEMA,
        sizeBytes: 100n,
        sharedLibrary: false,
      },
    )
    const householdObj = gateway.commit({
      app: 'cinema',
      filename: 'hh.mp4',
      data: mp4,
      sizeBytes: 100n,
    })
    expect(
      await codeOf(
        client.addMediaFile({
          reservationId: householdRes.reservationId,
          objectId: householdObj,
        }),
      ),
    ).toBe(Code.InvalidArgument)
    const [hh] = await database.db
      .select()
      .from(iamHouseholds)
      .where(eq(iamHouseholds.householdId, householdId))
    expect(hh?.usedBytes).toBe(0n)

    // Shared-library Arcade reservation is refused by CinemaService.
    const arcadeRes = await iamClient(app, superAdmin.headers).prepareUpload({
      app: App.ARCADE,
      sizeBytes: 100n,
      sharedLibrary: true,
    })
    const arcadeObj = gateway.commit({
      app: 'arcade',
      filename: 'rom.gba',
      data: mp4,
      sizeBytes: 100n,
    })
    expect(
      await codeOf(
        client.addMediaFile({
          reservationId: arcadeRes.reservationId,
          objectId: arcadeObj,
        }),
      ),
    ).toBe(Code.InvalidArgument)

    // Missing Gateway object fails with NotFound.
    const missingRes = await iamClient(app, superAdmin.headers).prepareUpload({
      app: App.CINEMA,
      sizeBytes: 100n,
      sharedLibrary: true,
    })
    expect(
      await codeOf(
        client.addMediaFile({
          reservationId: missingRes.reservationId,
          objectId: randomUUID(),
        }),
      ),
    ).toBe(Code.NotFound)

    // Reusing an already-claimed object with a new reservation fails with AlreadyExists.
    const claimed = await prepareSharedCinemaUpload(superAdmin, mp4)
    await client.addMediaFile(claimed)
    const secondRes = await iamClient(app, superAdmin.headers).prepareUpload({
      app: App.CINEMA,
      sizeBytes: 100n,
      sharedLibrary: true,
    })
    expect(
      await codeOf(
        client.addMediaFile({
          reservationId: secondRes.reservationId,
          objectId: claimed.objectId,
        }),
      ),
    ).toBe(Code.AlreadyExists)
  })
})

describe('ListMediaFiles', () => {
  async function addSample(filename: string, sizeBytes: bigint, addedAt: Date) {
    const upload = await prepareSharedCinemaUpload(
      superAdmin,
      ftypBytes('isom', ['isom']),
      { filename, sizeBytes },
    )
    const res = await cinemaClient(app, superAdmin.headers).addMediaFile(upload)
    await database.db
      .update(cinemaMediaFiles)
      .set({ addedAt })
      .where(eq(cinemaMediaFiles.id, res.file!.id))
    return res.file!
  }

  async function collectAllPages(
    client: Client<typeof CinemaService>,
    filter: MediaFileFilter,
    pageSize: number,
  ) {
    const items = []
    let pageToken = ''
    do {
      const page = await client.listMediaFiles({ filter, pageSize, pageToken })
      expect(page.files.length).toBeLessThanOrEqual(pageSize)
      items.push(...page.files)
      pageToken = page.nextPageToken
    } while (pageToken)
    return items
  }

  it('filters by all, unspecified, unmatched, and matched with movie and episode joins', async () => {
    const t0 = new Date('2026-01-01T00:00:00.100Z')
    const f1 = await addSample('unmatched-1.mp4', 100n, t0)
    const f2 = await addSample('movie-1.mp4', 200n, t0)
    const f3 = await addSample(
      'unmatched-2.mp4',
      300n,
      new Date('2026-01-01T00:00:01.000Z'),
    )
    const f4 = await addSample(
      'episode-1.mp4',
      400n,
      new Date('2026-01-01T00:00:02.000Z'),
    )
    const f5 = await addSample(
      'movie-no-year.mp4',
      500n,
      new Date('2026-01-01T00:00:03.000Z'),
    )

    const [movie] = await database.db
      .insert(cinemaMovies)
      .values({
        tmdbId: 693134,
        title: 'Dune: Part Two',
        releaseYear: 2024,
      })
      .returning()
    const [movieNoYear] = await database.db
      .insert(cinemaMovies)
      .values({
        tmdbId: 999999,
        title: 'Untitled',
        releaseYear: null,
      })
      .returning()
    const [series] = await database.db
      .insert(cinemaSeries)
      .values({
        tmdbId: 95396,
        title: 'Severance',
        firstAirYear: 2022,
      })
      .returning()
    const [episode] = await database.db
      .insert(cinemaEpisodes)
      .values({
        seriesId: series!.id,
        tmdbId: 3328759,
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'Good News About Hell',
      })
      .returning()

    await database.db
      .update(cinemaMediaFiles)
      .set({ movieId: movie!.id })
      .where(eq(cinemaMediaFiles.id, f2.id))
    await database.db
      .update(cinemaMediaFiles)
      .set({ episodeId: episode!.id })
      .where(eq(cinemaMediaFiles.id, f4.id))
    await database.db
      .update(cinemaMediaFiles)
      .set({ movieId: movieNoYear!.id })
      .where(eq(cinemaMediaFiles.id, f5.id))

    const client = cinemaClient(app, superAdmin.headers)

    const allDefault = await client.listMediaFiles({
      filter: MediaFileFilter.UNSPECIFIED,
      pageSize: MAX_PAGE_SIZE,
    })
    const allExplicit = await client.listMediaFiles({
      filter: MediaFileFilter.ALL,
      pageSize: MAX_PAGE_SIZE,
    })
    expect(allDefault.files).toEqual(allExplicit.files)
    expect(allDefault.files).toHaveLength(5)
    expect(allDefault.nextPageToken).toBe('')

    const unmatched = await client.listMediaFiles({
      filter: MediaFileFilter.UNMATCHED,
    })
    expect(unmatched.files.map((f) => f.id)).toEqual([f1.id, f3.id])
    expect(unmatched.files.every((f) => f.match.case === undefined)).toBe(true)

    const matched = await client.listMediaFiles({
      filter: MediaFileFilter.MATCHED,
    })
    expect(matched.files.map((f) => f.id)).toEqual([f2.id, f4.id, f5.id])
    expect(matched.files[0]).toMatchObject({
      id: f2.id,
      sizeBytes: 200n,
      match: {
        case: 'movie',
        value: {
          movieId: movie!.id,
          tmdbId: 693134,
          title: 'Dune: Part Two',
          releaseYear: 2024,
        },
      },
    })
    expect(matched.files[1]).toMatchObject({
      id: f4.id,
      sizeBytes: 400n,
      match: {
        case: 'episode',
        value: {
          seriesId: series!.id,
          episodeId: episode!.id,
          tmdbSeriesId: 95396,
          seriesTitle: 'Severance',
          seasonNumber: 1,
          episodeNumber: 1,
          episodeTitle: 'Good News About Hell',
        },
      },
    })
    expect(matched.files[2]?.match).toMatchObject({
      case: 'movie',
      value: {
        movieId: movieNoYear!.id,
        tmdbId: 999999,
        title: 'Untitled',
        releaseYear: 0,
      },
    })

    // Cursor paging across every filter (including tied addedAt on f1 and f2).
    const pagedAll = await collectAllPages(client, MediaFileFilter.ALL, 2)
    expect(pagedAll.map((f) => f.id)).toEqual(
      allExplicit.files.map((f) => f.id),
    )
    expect(new Set(pagedAll.map((f) => f.id)).size).toBe(5)

    const pagedUnmatched = await collectAllPages(
      client,
      MediaFileFilter.UNMATCHED,
      1,
    )
    expect(pagedUnmatched.map((f) => f.id)).toEqual([f1.id, f3.id])

    const pagedMatched = await collectAllPages(
      client,
      MediaFileFilter.MATCHED,
      2,
    )
    expect(pagedMatched.map((f) => f.id)).toEqual([f2.id, f4.id, f5.id])

    // Read-only RPC also works via HTTP GET.
    const viaGet = await cinemaClient(app, superAdmin.headers, {
      useHttpGet: true,
    }).listMediaFiles({ filter: MediaFileFilter.MATCHED })
    expect(viaGet.files.map((f) => f.id)).toEqual([f2.id, f4.id, f5.id])
  })

  it('rejects invalid page tokens, negative page size, and unknown filter values', async () => {
    const client = cinemaClient(app, superAdmin.headers)
    const nonUuidToken = Buffer.from(
      JSON.stringify({ c: '2026-01-01T00:00:00.000Z', i: 'not-a-uuid' }),
    ).toString('base64url')

    expect(await codeOf(client.listMediaFiles({ pageToken: 'garbage' }))).toBe(
      Code.InvalidArgument,
    )
    expect(
      await codeOf(client.listMediaFiles({ pageToken: nonUuidToken })),
    ).toBe(Code.InvalidArgument)
    expect(await codeOf(client.listMediaFiles({ pageSize: -1 }))).toBe(
      Code.InvalidArgument,
    )
    expect(
      await codeOf(client.listMediaFiles({ filter: 99 as MediaFileFilter })),
    ).toBe(Code.InvalidArgument)
  })
})
