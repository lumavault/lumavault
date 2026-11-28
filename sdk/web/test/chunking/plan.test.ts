import { Code, ConnectError } from '@connectrpc/connect'
import { planChunks } from '#/chunking/plan.js'
import { loadVectors, patternBytes } from '#test/support/vectors.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('planChunks', () => {
  afterEach(() => vi.unstubAllGlobals())
  for (const vector of loadVectors().files) {
    const expected = {
      sizeBytes: vector.sizeBytes,
      chunkSizeBytes: vector.chunkSizeBytes,
      sha256Digest: vector.sha256,
      chunkHashes: vector.chunkHashes,
    }

    it(`matches the shared vector for ${vector.name} (Uint8Array)`, async () => {
      expect(await planChunks(patternBytes(0, vector.sizeBytes))).toEqual(
        expected,
      )
    })

    it(`matches the shared vector for ${vector.name} (Blob)`, async () => {
      expect(
        await planChunks(new Blob([patternBytes(0, vector.sizeBytes)])),
      ).toEqual(expected)
    })
  }

  it('rejects an empty input with invalid_argument', async () => {
    for (const input of [new Uint8Array(0), new Blob([])]) {
      const err = await planChunks(input).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ConnectError)
      expect((err as ConnectError).code).toBe(Code.InvalidArgument)
    }
  })

  it('never reads more than one chunk at a time', async () => {
    const chunk = 4 * 1024 * 1024
    const size = 3 * chunk + 5
    let largestRead = 0
    let reads = 0
    // Stands in for a disk-backed File: bytes exist only for the slice being read.
    const lazyBlob = {
      size,
      slice: (start: number, end: number) => ({
        arrayBuffer: async () => {
          reads++
          largestRead = Math.max(largestRead, end - start)
          return patternBytes(start, end - start).buffer
        },
      }),
    } as unknown as Blob

    const plan = await planChunks(lazyBlob)
    expect(plan.chunkHashes).toHaveLength(4)
    expect(reads).toBe(4)
    expect(largestRead).toBe(chunk)
  })

  it('hashes chunks when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', { subtle: undefined })
    const vector =
      loadVectors().files.find((v) => v.chunkHashes.length > 1) ??
      loadVectors().files[0]!
    expect(await planChunks(patternBytes(0, vector.sizeBytes))).toEqual({
      sizeBytes: vector.sizeBytes,
      chunkSizeBytes: vector.chunkSizeBytes,
      sha256Digest: vector.sha256,
      chunkHashes: vector.chunkHashes,
    })
  })

  it('hashes a Uint8Array view backed by a SharedArrayBuffer', async () => {
    const vector = loadVectors().files[0]!
    const shared = new SharedArrayBuffer(vector.sizeBytes + 4)
    const view = new Uint8Array(shared, 4, vector.sizeBytes)
    view.set(patternBytes(0, vector.sizeBytes))
    expect(await planChunks(view)).toEqual({
      sizeBytes: vector.sizeBytes,
      chunkSizeBytes: vector.chunkSizeBytes,
      sha256Digest: vector.sha256,
      chunkHashes: vector.chunkHashes,
    })
  })
})
