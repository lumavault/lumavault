import { createHash } from 'node:crypto'
import { Code, ConnectError, LumaVaultClient, Namespace } from '@lumavault/sdk'
import { signReadTicket, signUploadTicket } from '#/auth/tickets.js'
import {
  createStorageGateway,
  type StorageGateway,
} from '#/lib/storage-gateway.js'
import { TEST_ENV } from '#test/support/context.js'
import { startTestGateway, type TestGateway } from '#test/support/gateway.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let gw: TestGateway
let storage: StorageGateway

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

async function uploadObject(bytes: Uint8Array, mimeType = 'image/jpeg') {
  const { ticket } = signUploadTicket(TEST_ENV.LUMAVAULT_TICKET_SECRET, {
    namespace: Namespace.PHOTOS,
    maxSizeBytes: BigInt(bytes.length),
  })
  const client = new LumaVaultClient({ baseUrl: gw.baseUrl })
  return client.upload(bytes, {
    namespace: Namespace.PHOTOS,
    filename: 'a.jpg',
    mimeType,
    ticket,
  })
}

async function putChunk(bytes: Uint8Array): Promise<string> {
  const hash = sha(bytes)
  const res = await fetch(`${gw.baseUrl}/v1/chunks/${hash}`, {
    method: 'PUT',
    body: bytes,
    headers: { 'X-LumaVault-Service-Key': TEST_ENV.LUMAVAULT_SERVICE_KEY },
  })
  expect(res.status).toBe(201)
  return hash
}

beforeAll(async () => {
  gw = await startTestGateway()
  storage = createStorageGateway({
    baseUrl: gw.baseUrl,
    serviceKey: TEST_ENV.LUMAVAULT_SERVICE_KEY,
  })
}, 120_000)

afterAll(() => gw?.stop())

describe('StorageGateway against a Gateway with ticket checks on', () => {
  it("reads an object's namespace, size, type, and file name", async () => {
    const bytes = new Uint8Array(1234).fill(7)
    const obj = await uploadObject(bytes)
    expect(await storage.stat(obj.id)).toEqual({
      id: obj.id,
      namespace: Namespace.PHOTOS,
      sizeBytes: 1234n,
      sha256Digest: sha(bytes),
      mimeType: 'image/jpeg',
      filename: 'a.jpg',
    })
  })

  it('returns null for an object that does not exist', async () => {
    expect(await storage.stat('no-such-object')).toBeNull()
    expect(await storage.readHead('no-such-object', 64 * 1024)).toBeNull()
  })

  it('reads the first 64 KiB of an object', async () => {
    const bytes = new Uint8Array(200 * 1024).map((_, i) => i % 251)
    const obj = await uploadObject(bytes, 'video/mp4')
    expect(await storage.readHead(obj.id, 64 * 1024)).toEqual(
      bytes.slice(0, 64 * 1024),
    )
  })

  it('reads all of an object smaller than the limit', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const obj = await uploadObject(bytes)
    expect(await storage.readHead(obj.id, 64 * 1024)).toEqual(bytes)
  })

  it('reads an empty object as no bytes', async () => {
    const spy = vi
      .spyOn(LumaVaultClient.prototype, 'readRange')
      .mockRejectedValueOnce(
        new ConnectError('range not satisfiable', Code.OutOfRange),
      )
    try {
      expect(await storage.readHead('empty-object', 64 * 1024)).toEqual(
        new Uint8Array(0),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('sets a thumbnail that is already uploaded', async () => {
    const obj = await uploadObject(new Uint8Array(10).fill(1))
    const thumb = await putChunk(new Uint8Array([9, 9, 9]))
    await storage.setThumbnail(obj.id, thumb)
    const admin = new LumaVaultClient({
      baseUrl: gw.baseUrl,
      serviceKey: TEST_ENV.LUMAVAULT_SERVICE_KEY,
    })
    expect((await admin.get(obj.id)).thumbnailChunkHash).toBe(thumb)
  })

  it('deletes an object, and deleting it again succeeds', async () => {
    const obj = await uploadObject(new Uint8Array(10).fill(2))
    await storage.delete(obj.id)
    expect(await storage.stat(obj.id)).toBeNull()
    await expect(storage.delete(obj.id)).resolves.toBeUndefined()
  })

  it('uploads a small image with the service key and serves it through a signed read URL', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
    const uploaded = await storage.upload({
      bytes,
      namespace: Namespace.CINEMA,
      filename: 'poster.jpg',
      mimeType: 'image/jpeg',
    })
    expect(uploaded).toEqual({
      id: uploaded.id,
      namespace: Namespace.CINEMA,
      sizeBytes: BigInt(bytes.byteLength),
      sha256Digest: sha(bytes),
      mimeType: 'image/jpeg',
      filename: 'poster.jpg',
    })
    expect(await storage.stat(uploaded.id)).toEqual(uploaded)

    const { ticket } = signReadTicket(TEST_ENV.LUMAVAULT_TICKET_SECRET, {
      objectId: uploaded.id,
    })
    const url = new LumaVaultClient({ baseUrl: gw.baseUrl }).streamUrl(
      uploaded.id,
      ticket,
    )
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it('gives duplicate server uploads their own manifests so deleting one keeps the other', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40])
    const first = await storage.upload({
      bytes,
      namespace: Namespace.CINEMA,
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
    })
    const second = await storage.upload({
      bytes,
      namespace: Namespace.CINEMA,
      filename: 'b.jpg',
      mimeType: 'image/jpeg',
    })
    expect(first.id).not.toBe(second.id)

    await storage.delete(first.id)
    expect(await storage.stat(first.id)).toBeNull()
    expect(await storage.stat(second.id)).toEqual(second)
  })

  it('rejects empty uploads or missing metadata', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    for (const bad of [
      {
        bytes: new Uint8Array(0),
        namespace: Namespace.CINEMA,
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
      },
      {
        bytes,
        namespace: Namespace.CINEMA,
        filename: '   ',
        mimeType: 'image/jpeg',
      },
      {
        bytes,
        namespace: Namespace.CINEMA,
        filename: 'a.jpg',
        mimeType: '',
      },
    ]) {
      const err = await storage.upload(bad).catch((e: unknown) => e)
      expect(ConnectError.from(err).code).toBe(Code.InvalidArgument)
    }
  })

  it('is rejected without the right service key', async () => {
    const wrong = createStorageGateway({
      baseUrl: gw.baseUrl,
      serviceKey: 'not-the-key',
    })
    const statErr = await wrong.stat('anything').catch((e: unknown) => e)
    expect(ConnectError.from(statErr).code).toBe(Code.Unauthenticated)

    const uploadErr = await wrong
      .upload({
        bytes: new Uint8Array([1, 2, 3]),
        namespace: Namespace.CINEMA,
        filename: 'poster.jpg',
        mimeType: 'image/jpeg',
      })
      .catch((e: unknown) => e)
    expect(ConnectError.from(uploadErr).code).toBe(Code.Unauthenticated)
  })
})
