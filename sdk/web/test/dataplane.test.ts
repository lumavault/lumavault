import { Code, ConnectError } from '@connectrpc/connect'
import {
  chunkUrl,
  getChunk,
  getRange,
  putChunk,
  streamUrl,
} from '#/dataplane.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const BASE = 'http://gw:8080'
const HASH = 'a'.repeat(64)

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

async function failure(p: Promise<unknown>): Promise<ConnectError> {
  const err = await p.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ConnectError)
  return err as ConnectError
}

describe('urls', () => {
  for (const base of ['http://gw:8080', 'http://gw:8080/']) {
    it(`builds routes from ${base}`, () => {
      expect(chunkUrl(base, 'ab12')).toBe('http://gw:8080/v1/chunks/ab12')
      expect(streamUrl(base, 'obj/1')).toBe('http://gw:8080/v1/stream/obj%2F1')
    })

    it(`builds stream URLs with tickets and download options from ${base}`, () => {
      expect(streamUrl(base, 'obj/1', 't k')).toBe(
        'http://gw:8080/v1/stream/obj%2F1?token=t%20k',
      )
      expect(streamUrl(base, 'obj/1', { ticket: 't k' })).toBe(
        'http://gw:8080/v1/stream/obj%2F1?token=t%20k',
      )
      expect(streamUrl(base, 'obj/1', { download: true })).toBe(
        'http://gw:8080/v1/stream/obj%2F1?download=1',
      )
      expect(streamUrl(base, 'obj/1', { download: false })).toBe(
        'http://gw:8080/v1/stream/obj%2F1',
      )
      expect(streamUrl(base, 'obj/1', { ticket: 't k', download: true })).toBe(
        'http://gw:8080/v1/stream/obj%2F1?token=t%20k&download=1',
      )
      expect(streamUrl(base, 'obj/1', {})).toBe(
        'http://gw:8080/v1/stream/obj%2F1',
      )
      expect(streamUrl(base, 'obj/1', { ticket: '', download: true })).toBe(
        'http://gw:8080/v1/stream/obj%2F1?download=1',
      )

      const signed = new URL(
        streamUrl(base, 'obj/1', { ticket: 'v1.a+b/c', download: true }),
      )
      expect(signed.pathname).toBe('/v1/stream/obj%2F1')
      expect(signed.searchParams.get('token')).toBe('v1.a+b/c')
      expect(signed.searchParams.get('download')).toBe('1')
    })
  }
})

describe('data plane errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  const cases: [number, Code][] = [
    [400, Code.InvalidArgument],
    [404, Code.NotFound],
    [416, Code.OutOfRange],
    [413, Code.InvalidArgument],
    [401, Code.Unauthenticated],
    [403, Code.PermissionDenied],
    [500, Code.Internal],
    [503, Code.Unavailable],
  ]
  for (const [status, code] of cases) {
    it(`maps HTTP ${status} to ${Code[code]} with the gateway message`, async () => {
      respond(status, { error: 'boom' })
      const err = await failure(getChunk(BASE, HASH, {}))
      expect(err.code).toBe(code)
      expect(err.rawMessage).toBe('boom')
    })
  }

  it('maps a network failure to unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
    )
    expect((await failure(getChunk(BASE, HASH, {}))).code).toBe(
      Code.Unavailable,
    )
  })

  it('rejects a PUT when the gateway stored a different size', async () => {
    respond(201, { sha256: HASH, size_bytes: 2 })
    expect(
      (await failure(putChunk(BASE, HASH, new Uint8Array(3), {}))).code,
    ).toBe(Code.Internal)
  })

  it('accepts a PUT when the stored size matches', async () => {
    respond(201, { sha256: HASH, size_bytes: 3 })
    await expect(
      putChunk(BASE, HASH, new Uint8Array(3), {}),
    ).resolves.toBeUndefined()
  })
})

describe('getRange', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("asks the stream route for an inclusive byte range with the caller's headers", async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 206 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await getRange(BASE, 'obj/1', 10, 3, { 'X-Test': 'yes' })).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(`${BASE}/v1/stream/obj%2F1`)
    expect(init.headers).toEqual({ 'X-Test': 'yes', Range: 'bytes=10-12' })
  })

  it('rejects a negative start or a length below one without calling the gateway', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const [start, length] of [
      [-1, 1],
      [0, 0],
      [0.5, 1],
    ] as const) {
      expect((await failure(getRange(BASE, 'o', start, length, {}))).code).toBe(
        Code.InvalidArgument,
      )
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
