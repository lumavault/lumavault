import {
  Code,
  ConnectError,
  LumaVaultClient,
  Namespace,
  type UploadProgress,
} from '#/index.js'
import { startGateway, type TestGateway } from '#test/support/gateway.js'
import { mintTicket, TICKET_ENV } from '#test/support/tickets.js'
import { patternBytes } from '#test/support/vectors.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const MIB = 1024 * 1024

describe('LumaVaultClient against a real gateway', () => {
  let gateway: TestGateway
  let client: LumaVaultClient

  beforeAll(async () => {
    gateway = await startGateway()
    client = new LumaVaultClient({ baseUrl: gateway.baseUrl })
  }, 120_000)
  afterAll(() => gateway?.stop())

  async function readAll(
    stream: ReadableStream<Uint8Array>,
  ): Promise<Uint8Array> {
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  it('uploads, downloads identical bytes, and reports progress', async () => {
    const bytes = patternBytes(0, 9 * MIB)
    const events: UploadProgress[] = []
    const obj = await client.upload(
      new File([bytes], 'movie.bin', { type: 'video/mp4' }),
      {
        namespace: Namespace.CINEMA,
        onProgress: (p) => events.push(p),
      },
    )

    expect(obj.filename).toBe('movie.bin')
    expect(obj.mimeType).toBe('video/mp4')
    expect(obj.chunkHashes).toHaveLength(3)
    expect(obj.url).toBe(client.streamUrl(obj.id))
    expect(await readAll(client.download(obj.id))).toEqual(bytes)

    expect(events[0]?.phase).toBe('hashing')
    expect(events.at(-1)).toEqual({
      phase: 'uploading',
      loaded: 9 * MIB,
      total: 9 * MIB,
      percentage: 100,
    })
  }, 30_000) // Hashing and moving 9 MiB can pass 5s on shared CI runners.

  it('reads byte ranges, across chunks and cut short at the end', async () => {
    const bytes = patternBytes(13, 9 * MIB)
    const obj = await client.upload(new File([bytes], 'range.bin'), {
      namespace: Namespace.CINEMA,
    })
    expect(await client.readRange(obj.id, 0, 64 * 1024)).toEqual(
      bytes.slice(0, 64 * 1024),
    )
    expect(await client.readRange(obj.id, 4 * MIB - 10, 20)).toEqual(
      bytes.slice(4 * MIB - 10, 4 * MIB + 10),
    )
    expect(await client.readRange(obj.id, 9 * MIB - 5, 100)).toEqual(
      bytes.slice(9 * MIB - 5),
    )

    const past = await client
      .readRange(obj.id, 9 * MIB, 1)
      .catch((e: unknown) => e)
    expect((past as ConnectError).code).toBe(Code.OutOfRange)
    const missing = await client
      .readRange('no-such-object', 0, 1)
      .catch((e: unknown) => e)
    expect((missing as ConnectError).code).toBe(Code.NotFound)
  }, 30_000)

  it('re-uploading the same bytes sends no chunks and creates a new object', async () => {
    const bytes = patternBytes(7, 5 * MIB)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const putCount = () =>
      fetchSpy.mock.calls.filter(([, init]) => init?.method === 'PUT').length

    const first = await client.upload(bytes, {
      namespace: Namespace.PHOTOS,
      filename: 'a.jpg',
    })
    expect(putCount()).toBe(2)
    fetchSpy.mockClear()

    const events: UploadProgress[] = []
    const second = await client.upload(bytes, {
      namespace: Namespace.PHOTOS,
      filename: 'a.jpg',
      onProgress: (p) => events.push(p),
    })
    const puts = putCount()
    fetchSpy.mockRestore()

    expect(puts).toBe(0)
    expect(second.id).not.toBe(first.id)
    expect(events.find((e) => e.phase === 'uploading')?.percentage).toBe(100)
  })

  it('requires a filename for a plain Blob', async () => {
    const err = await client
      .upload(new Blob([patternBytes(0, 10)]), { namespace: Namespace.GAMES })
      .catch((e: unknown) => e)
    expect((err as ConnectError).code).toBe(Code.InvalidArgument)
  })

  it('gets, updates, and deletes', async () => {
    const created = await client.upload(patternBytes(1, 101), {
      namespace: Namespace.GAMES,
      filename: 'save1.sav',
    })

    const updated = await client.update(created.id, { filename: 'renamed.sav' })
    expect(updated.filename).toBe('renamed.sav')
    expect((await client.get(created.id)).filename).toBe('renamed.sav')

    await client.delete(created.id)
    const err = await client.get(created.id).catch((e: unknown) => e)
    expect((err as ConnectError).code).toBe(Code.NotFound)
  })

  it('adds Content-Disposition attachment only when streamUrl has download enabled', async () => {
    const bytes = patternBytes(21, 1024)
    const obj = await client.upload(
      new File([bytes], 'clip.mp4', { type: 'video/mp4' }),
      { namespace: Namespace.CINEMA },
    )

    const inline = await fetch(client.streamUrl(obj.id))
    expect(inline.status).toBe(200)
    expect(inline.headers.get('content-disposition')).toBeNull()

    const attachment = await fetch(client.streamUrl(obj.id, { download: true }))
    expect(attachment.status).toBe(200)
    expect(attachment.headers.get('content-disposition')).toBe(
      'attachment; filename=clip.mp4',
    )
    expect(new Uint8Array(await attachment.arrayBuffer())).toEqual(bytes)
  })

  it('triggers an attachment download with a signed download URL', async () => {
    const signedGateway = await startGateway(TICKET_ENV)
    try {
      const signedClient = new LumaVaultClient({
        baseUrl: signedGateway.baseUrl,
      })
      const bytes = patternBytes(34, 1024)
      const obj = await signedClient.upload(
        new File([bytes], 'movie.mp4', { type: 'video/mp4' }),
        {
          namespace: Namespace.CINEMA,
          ticket: mintTicket({
            k: 'up',
            ns: Namespace.CINEMA,
            max: bytes.length,
          }),
        },
      )

      const unauth = await fetch(
        signedClient.streamUrl(obj.id, { download: true }),
      )
      expect(unauth.status).toBe(401)

      const read = mintTicket({ k: 'rd', obj: obj.id })
      const res = await fetch(
        signedClient.streamUrl(obj.id, { ticket: read, download: true }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename=movie.mp4',
      )
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
    } finally {
      signedGateway.stop()
    }
  }, 120_000)
})
