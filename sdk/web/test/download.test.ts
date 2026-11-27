import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { planChunks } from '#/chunking/plan.js'
import { verifiedStream, type ChunkFetcher } from '#/download.js'
import { ObjectMetadataSchema } from '#/gen/lumavault/v1/storage_pb.js'
import { patternBytes } from '#test/support/vectors.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const CHUNK = 4 * 1024 * 1024

async function fixture(size: number) {
  const bytes = patternBytes(0, size)
  const plan = await planChunks(bytes)
  const meta = create(ObjectMetadataSchema, {
    id: 'obj1',
    sha256Digest: plan.sha256Digest,
    chunkHashes: plan.chunkHashes,
  })
  const chunks = new Map(
    plan.chunkHashes.map((h, i) => [
      h,
      bytes.slice(i * CHUNK, (i + 1) * CHUNK),
    ]),
  )
  return { bytes, meta, chunks }
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

describe('verifiedStream', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the original bytes when every hash matches', async () => {
    const { bytes, meta, chunks } = await fixture(2 * CHUNK + 7)
    const fetchChunk: ChunkFetcher = async (h) => chunks.get(h)!
    expect(
      await readAll(verifiedStream(Promise.resolve(meta), fetchChunk)),
    ).toEqual(bytes)
  })

  it('fetches a chunk only when the reader asks for it', async () => {
    const { meta, chunks } = await fixture(3 * CHUNK)
    let fetches = 0
    const reader = verifiedStream(
      Promise.resolve(meta),
      async (h) => (fetches++, chunks.get(h)!),
    ).getReader()
    await reader.read()
    await new Promise((r) => setTimeout(r, 10))
    expect(fetches).toBe(1)
    await reader.cancel()
  })

  it('fails with data_loss when a chunk is corrupted', async () => {
    const { meta, chunks } = await fixture(CHUNK + 1)
    const fetchChunk: ChunkFetcher = async (h) => {
      const copy = chunks.get(h)!.slice()
      copy[0] ^= 0xff
      return copy
    }
    const err = await readAll(
      verifiedStream(Promise.resolve(meta), fetchChunk),
    ).catch((e: unknown) => e)
    expect((err as ConnectError).code).toBe(Code.DataLoss)
  })

  it('fails with data_loss when the whole-file hash does not match', async () => {
    const { meta, chunks } = await fixture(CHUNK + 1)
    meta.sha256Digest = '0'.repeat(64)
    const err = await readAll(
      verifiedStream(Promise.resolve(meta), async (h) => chunks.get(h)!),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConnectError)
    expect((err as ConnectError).code).toBe(Code.DataLoss)
  })

  it('verifies chunks and whole-file hash when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', { subtle: undefined })
    const { bytes, meta, chunks } = await fixture(2 * CHUNK + 7)
    expect(
      await readAll(
        verifiedStream(Promise.resolve(meta), async (h) => chunks.get(h)!),
      ),
    ).toEqual(bytes)
  })
})
