import { createHash, randomUUID } from 'node:crypto'
import { Code } from '@connectrpc/connect'
import { LumaVaultClient } from '@lumavault/sdk'
import { organization } from '#/db/schemas/auth.js'
import { cinemaMovies } from '#/db/schemas/cinema.js'
import { iamHouseholds, iamObjectClaims } from '#/db/schemas/iam.js'
import {
  createStorageGateway,
  type StorageGateway,
  type StoredObject,
  type UploadObjectInput,
} from '#/lib/storage-gateway.js'
import type { ModuleContext } from '#/server/modules.js'
import {
  APP_NAMESPACE,
  releaseObject,
  signObjectReadTicket,
  storeServerObject,
} from '#/services/quotas/index.js'
import { createTestContext, TEST_ENV } from '#test/support/context.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import { startTestGateway, type TestGateway } from '#test/support/gateway.js'
import { codeOf } from '#test/support/rpc.js'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Valid 1x1 PNG so image headers and bytes are realistic.
const SAMPLE_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
])

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

class FakeGateway implements StorageGateway {
  objects = new Map<string, StoredObject>()
  deleted: string[] = []
  nextObjectId: string | null = null

  async stat(objectId: string) {
    return this.objects.get(objectId) ?? null
  }

  async readHead(objectId: string) {
    return this.objects.has(objectId) ? new Uint8Array(0) : null
  }

  async upload(input: UploadObjectInput): Promise<StoredObject> {
    const id = this.nextObjectId ?? randomUUID()
    this.nextObjectId = null
    const stored: StoredObject = {
      id,
      namespace: input.namespace,
      sizeBytes: BigInt(input.bytes.byteLength),
      sha256Digest: sha(input.bytes),
      mimeType: input.mimeType,
      filename: input.filename,
    }
    this.objects.set(id, stored)
    return stored
  }

  async delete(objectId: string) {
    this.deleted.push(objectId)
    this.objects.delete(objectId)
  }

  async setThumbnail() {}
}

describe('storeServerObject with fake Gateway', () => {
  let database: TestDatabase
  let gateway: FakeGateway
  let ctx: ModuleContext

  beforeAll(async () => {
    database = await createTestDatabase()
    await pushAllSchemas(database)
    gateway = new FakeGateway()
    ctx = createTestContext(database, { gateway })
  })

  afterAll(async () => {
    await database?.drop()
  })

  it('uploads into the app namespace and claims the object with no household billed', async () => {
    const householdId = randomUUID()
    await database.db.insert(organization).values({
      id: householdId,
      name: 'Home',
      slug: householdId,
      createdAt: new Date(),
    })
    await database.db.insert(iamHouseholds).values({
      householdId,
      storageCapBytes: 1000n,
      enabledApps: ['cinema'],
    })

    const stored = await storeServerObject(ctx, {
      app: 'cinema',
      bytes: SAMPLE_PNG,
      filename: 'poster.png',
      mimeType: 'image/png',
    })

    expect(stored).toEqual({
      objectId: stored.objectId,
      bytes: BigInt(SAMPLE_PNG.byteLength),
      sha256Digest: sha(SAMPLE_PNG),
      mimeType: 'image/png',
      filename: 'poster.png',
    })
    expect(gateway.objects.get(stored.objectId)?.namespace).toBe(
      APP_NAMESPACE.cinema,
    )

    const [claim] = await database.db
      .select()
      .from(iamObjectClaims)
      .where(eq(iamObjectClaims.objectId, stored.objectId))
    expect(claim).toMatchObject({
      objectId: stored.objectId,
      householdId: null,
      uploadedBy: null,
      reservationId: null,
      app: 'cinema',
      bytes: BigInt(SAMPLE_PNG.byteLength),
      releasedAt: null,
    })

    // Households are never billed for server-made objects.
    const [household] = await database.db
      .select()
      .from(iamHouseholds)
      .where(eq(iamHouseholds.householdId, householdId))
    expect(household?.usedBytes).toBe(0n)
    expect(household?.reservedBytes).toBe(0n)
  })

  it('allows multiple server-made objects and satisfies cinema art foreign keys', async () => {
    const poster = await storeServerObject(ctx, {
      app: 'cinema',
      bytes: SAMPLE_PNG,
      filename: 'poster.png',
      mimeType: 'image/png',
    })
    const backdrop = await storeServerObject(ctx, {
      app: 'cinema',
      bytes: SAMPLE_PNG,
      filename: 'backdrop.png',
      mimeType: 'image/png',
    })

    const [movie] = await database.db
      .insert(cinemaMovies)
      .values({
        tmdbId: 603,
        title: 'The Matrix',
        posterPath: '/poster.png',
        backdropPath: '/backdrop.png',
        posterObjectId: poster.objectId,
        backdropObjectId: backdrop.objectId,
      })
      .returning()

    expect(movie?.posterObjectId).toBe(poster.objectId)
    expect(movie?.backdropObjectId).toBe(backdrop.objectId)
  })

  it('releases through releaseObject with zero refund and revokes future read tickets', async () => {
    const stored = await storeServerObject(ctx, {
      app: 'cinema',
      bytes: SAMPLE_PNG,
      filename: 'still.png',
      mimeType: 'image/png',
    })

    await expect(
      signObjectReadTicket(ctx, stored.objectId),
    ).resolves.toMatchObject({ ticket: expect.any(String) })

    expect(await releaseObject(ctx, stored.objectId)).toEqual({ refunded: 0n })
    expect(gateway.objects.has(stored.objectId)).toBe(false)

    const [claim] = await database.db
      .select()
      .from(iamObjectClaims)
      .where(eq(iamObjectClaims.objectId, stored.objectId))
    expect(claim?.releasedAt).toBeInstanceOf(Date)

    // Repeating release is a safe no-op, and read tickets are refused.
    expect(await releaseObject(ctx, stored.objectId)).toEqual({ refunded: 0n })
    expect(await codeOf(signObjectReadTicket(ctx, stored.objectId))).toBe(
      Code.NotFound,
    )
  })

  it('rejects empty bytes, blank filename, and blank mimeType before calling the Gateway', async () => {
    const before = gateway.objects.size
    expect(
      await codeOf(
        storeServerObject(ctx, {
          app: 'cinema',
          bytes: new Uint8Array(0),
          filename: 'empty.png',
          mimeType: 'image/png',
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        storeServerObject(ctx, {
          app: 'cinema',
          bytes: SAMPLE_PNG,
          filename: '   ',
          mimeType: 'image/png',
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(
      await codeOf(
        storeServerObject(ctx, {
          app: 'cinema',
          bytes: SAMPLE_PNG,
          filename: 'poster.png',
          mimeType: ' ',
        }),
      ),
    ).toBe(Code.InvalidArgument)
    expect(gateway.objects.size).toBe(before)
  })

  it('deletes the Gateway object if recording the claim fails, and keeps existing objects on conflict', async () => {
    const first = await storeServerObject(ctx, {
      app: 'cinema',
      bytes: SAMPLE_PNG,
      filename: 'first.png',
      mimeType: 'image/png',
    })

    // A duplicate object ID from the Gateway must fail with AlreadyExists without deleting the original.
    gateway.nextObjectId = first.objectId
    expect(
      await codeOf(
        storeServerObject(ctx, {
          app: 'cinema',
          bytes: SAMPLE_PNG,
          filename: 'duplicate.png',
          mimeType: 'image/png',
        }),
      ),
    ).toBe(Code.AlreadyExists)
    expect(gateway.objects.has(first.objectId)).toBe(true)

    // Any other DB failure deletes the just-uploaded object so no orphan remains on disk.
    const orphanId = randomUUID()
    gateway.nextObjectId = orphanId
    const brokenDb = {
      insert() {
        return {
          values() {
            return Promise.reject(new Error('db unavailable'))
          },
        }
      },
    } as unknown as ModuleContext['db']

    await expect(
      storeServerObject(
        { db: brokenDb, gateway },
        {
          app: 'cinema',
          bytes: SAMPLE_PNG,
          filename: 'orphan.png',
          mimeType: 'image/png',
        },
      ),
    ).rejects.toThrow('db unavailable')
    expect(gateway.objects.has(orphanId)).toBe(false)
    expect(gateway.deleted).toContain(orphanId)
  })
})

describe('storeServerObject against a running Gateway', () => {
  let database: TestDatabase
  let gw: TestGateway
  let ctx: ModuleContext

  beforeAll(async () => {
    ;[database, gw] = await Promise.all([
      createTestDatabase(),
      startTestGateway(),
    ])
    await pushAllSchemas(database)
    const gateway = createStorageGateway({
      baseUrl: gw.baseUrl,
      serviceKey: TEST_ENV.LUMAVAULT_SERVICE_KEY,
    })
    ctx = createTestContext(database, {
      env: { LUMAVAULT_GATEWAY_URL: gw.baseUrl },
      gateway,
    })
  }, 120_000)

  afterAll(async () => {
    gw?.stop()
    await database?.drop()
  })

  it('serves a stored image through a signed read URL and removes it on release', async () => {
    const stored = await storeServerObject(ctx, {
      app: 'cinema',
      bytes: SAMPLE_PNG,
      filename: 'poster.png',
      mimeType: 'image/png',
    })

    const { ticket } = await signObjectReadTicket(ctx, stored.objectId)
    const url = new LumaVaultClient({ baseUrl: gw.baseUrl }).streamUrl(
      stored.objectId,
      ticket,
    )

    // Plain GET with no auth headers, matching how a browser loads an img tag.
    const loaded = await fetch(url)
    expect(loaded.status).toBe(200)
    expect(loaded.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(SAMPLE_PNG)

    expect(await releaseObject(ctx, stored.objectId)).toEqual({ refunded: 0n })

    const [claim] = await database.db
      .select()
      .from(iamObjectClaims)
      .where(eq(iamObjectClaims.objectId, stored.objectId))
    expect(claim?.releasedAt).toBeInstanceOf(Date)
    expect(await ctx.gateway.stat(stored.objectId)).toBeNull()

    const afterRelease = await fetch(url)
    expect(afterRelease.status).toBe(404)
    expect(await codeOf(signObjectReadTicket(ctx, stored.objectId))).toBe(
      Code.NotFound,
    )
  })
})
