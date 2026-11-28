import { authHeaders } from '#/client.js'
import { Code, ConnectError, LumaVaultClient, Namespace } from '#/index.js'
import { startGateway, type TestGateway } from '#test/support/gateway.js'
import {
  mintTicket,
  TEST_SERVICE_KEY,
  TICKET_ENV,
} from '#test/support/tickets.js'
import { patternBytes } from '#test/support/vectors.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIB = 1024 * 1024

async function codeOf(promise: Promise<unknown>): Promise<Code | 'ok'> {
  try {
    await promise
    return 'ok'
  } catch (err) {
    return ConnectError.from(err).code
  }
}

describe('authHeaders', () => {
  it('prefers a ticket over the service key', () => {
    expect(authHeaders({ ticket: 't', serviceKey: 'k' })).toEqual({
      Authorization: 'Bearer t',
    })
    expect(authHeaders({ serviceKey: 'k' })).toEqual({
      'X-LumaVault-Service-Key': 'k',
    })
    expect(authHeaders({})).toEqual({})
  })
})

describe('storage tickets against a gateway with checks on', () => {
  let gateway: TestGateway
  let client: LumaVaultClient
  let server: LumaVaultClient

  beforeAll(async () => {
    gateway = await startGateway(TICKET_ENV)
    client = new LumaVaultClient({ baseUrl: gateway.baseUrl })
    server = new LumaVaultClient({
      baseUrl: gateway.baseUrl,
      serviceKey: TEST_SERVICE_KEY,
    })
  }, 120_000)
  afterAll(() => gateway?.stop())

  const bytes = patternBytes(7, 5 * MIB)
  const file = () => new File([bytes], 'clip.bin', { type: 'video/mp4' })
  const uploadTicket = () =>
    mintTicket({ k: 'up', ns: Namespace.CINEMA, max: bytes.length })

  it('rejects calls without a ticket as unauthenticated', async () => {
    expect(
      await codeOf(client.upload(file(), { namespace: Namespace.CINEMA })),
    ).toBe(Code.Unauthenticated)
    expect(await codeOf(client.get('anything'))).toBe(Code.Unauthenticated)
  })

  it('uploads with an upload ticket, then downloads and streams with a read ticket', async () => {
    const obj = await client.upload(file(), {
      namespace: Namespace.CINEMA,
      ticket: uploadTicket(),
    })
    const read = mintTicket({ k: 'rd', obj: obj.id })

    expect((await client.get(obj.id, { ticket: read })).id).toBe(obj.id)
    const downloaded = new Uint8Array(
      await new Response(
        client.download(obj.id, { ticket: read }),
      ).arrayBuffer(),
    )
    expect(downloaded).toEqual(bytes)

    const res = await fetch(client.streamUrl(obj.id, read), {
      headers: { Range: 'bytes=10-19' },
    })
    expect(res.status).toBe(206)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      bytes.subarray(10, 20),
    )

    const chunk = await fetch(client.chunkUrl(obj.chunkHashes[0]!, read))
    expect(chunk.status).toBe(200)
  })

  it('maps a ticket used outside its scope to permission_denied', async () => {
    const obj = await client.upload(file(), {
      namespace: Namespace.CINEMA,
      ticket: uploadTicket(),
    })
    const other = mintTicket({ k: 'rd', obj: 'another-object' })
    expect(await codeOf(client.get(obj.id, { ticket: other }))).toBe(
      Code.PermissionDenied,
    )
    const stream = client.download(obj.id, {
      ticket: mintTicket({ k: 'rd', chk: obj.chunkHashes[0]! }),
    })
    expect(await codeOf(new Response(stream).arrayBuffer())).toBe(
      Code.PermissionDenied,
    )
  })

  it('lets the service key list, rename, and delete', async () => {
    const obj = await client.upload(file(), {
      namespace: Namespace.CINEMA,
      ticket: uploadTicket(),
    })
    expect(
      (await server.update(obj.id, { filename: 'renamed.bin' })).filename,
    ).toBe('renamed.bin')
    expect(
      (await server.list({ namespace: Namespace.CINEMA })).objects.map(
        (o) => o.id,
      ),
    ).toContain(obj.id)
    await server.delete(obj.id)
    expect(await codeOf(server.get(obj.id))).toBe(Code.NotFound)
    expect(await codeOf(client.list({ namespace: Namespace.CINEMA }))).toBe(
      Code.Unauthenticated,
    )
  })

  it('lets the service key copy an object, and refuses a client with no key', async () => {
    const obj = await client.upload(file(), {
      namespace: Namespace.CINEMA,
      ticket: uploadTicket(),
    })
    const copy = await server.copy(obj.id)
    expect(copy.id).not.toBe(obj.id)
    expect(copy.chunkHashes).toEqual(obj.chunkHashes)
    expect(copy).toMatchObject({
      namespace: obj.namespace,
      filename: obj.filename,
      sizeBytes: obj.sizeBytes,
    })
    expect(await codeOf(client.copy(obj.id))).toBe(Code.Unauthenticated)
  })

  it('builds thumbnail URLs only when the object has one', () => {
    expect(client.thumbnailUrl({ thumbnailChunkHash: '' })).toBeNull()
    expect(client.thumbnailUrl({ thumbnailChunkHash: 'ab' }, 't k')).toBe(
      `${gateway.baseUrl}/v1/chunks/ab?token=t%20k`,
    )
  })
})
