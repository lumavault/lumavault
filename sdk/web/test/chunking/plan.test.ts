import { Code, ConnectError } from '@connectrpc/connect'
import { planChunks } from '#/chunking/plan.js'
import { loadVectors, patternBytes } from '#test/support/vectors.js'
import { describe, expect, it } from 'vitest'

describe('planChunks', () => {
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

  function lazyBlob(size: number) {
    let largestRead = 0
    let reads = 0
    // Stands in for a disk-backed File: bytes exist only for the slice being read.
    const blob = {
      size,
      slice: (start: number, end: number) => ({
        arrayBuffer: async () => {
          reads++
          largestRead = Math.max(largestRead, end - start)
          return patternBytes(start, end - start).buffer
        },
      }),
    } as unknown as Blob
    return {
      blob,
      get reads() {
        return reads
      },
      get largestRead() {
        return largestRead
      },
    }
  }

  it('never reads more than one chunk at a time', async () => {
    const chunk = 4 * 1024 * 1024
    const input = lazyBlob(3 * chunk + 5)

    const plan = await planChunks(input.blob)
    expect(plan.chunkHashes).toHaveLength(4)
    expect(input.reads).toBe(4)
    expect(input.largestRead).toBe(chunk)
  })

  it('stops before reading when the signal is already aborted', async () => {
    const chunk = 4 * 1024 * 1024
    const input = lazyBlob(3 * chunk + 5)
    const controller = new AbortController()
    controller.abort()

    await expect(
      planChunks(input.blob, undefined, controller.signal),
    ).rejects.toBe(controller.signal.reason)
    expect(input.reads).toBe(0)
  })

  it('stops between chunks when aborted during hashing', async () => {
    const chunk = 4 * 1024 * 1024
    const input = lazyBlob(3 * chunk + 5)
    const controller = new AbortController()
    let hashedEvents = 0

    const err = await planChunks(
      input.blob,
      () => {
        hashedEvents++
        controller.abort()
      },
      controller.signal,
    ).catch((e: unknown) => e)
    expect(err).toBe(controller.signal.reason)
    expect(input.reads).toBe(1)
    expect(hashedEvents).toBe(1)
  })
})
