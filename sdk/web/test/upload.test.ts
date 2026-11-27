import type { Client } from '@connectrpc/connect'
import {
  Namespace,
  type StorageService,
} from '#/gen/lumavault/v1/storage_pb.js'
import { upload } from '#/upload.js'
import { patternBytes } from '#test/support/vectors.js'
import { describe, expect, it, vi } from 'vitest'

describe('upload cancellation during hashing', () => {
  const chunk = 4 * 1024 * 1024

  function lazyInput(size: number) {
    let reads = 0
    const blob = {
      size,
      slice: (start: number, end: number) => ({
        arrayBuffer: async () => {
          reads++
          return patternBytes(start, end - start).buffer
        },
      }),
    } as unknown as Blob
    return {
      blob,
      get reads() {
        return reads
      },
    }
  }

  it('stops early without reading remaining chunks or calling the gateway', async () => {
    const input = lazyInput(3 * chunk + 5)
    const hasChunks = vi.fn()
    const rpc = { hasChunks } as unknown as Client<typeof StorageService>
    const controller = new AbortController()

    const err = await upload(
      rpc,
      'http://unused.invalid',
      input.blob,
      {
        namespace: Namespace.CINEMA,
        filename: 'movie.bin',
        signal: controller.signal,
        onProgress: () => controller.abort(),
      },
      {},
    ).catch((e: unknown) => e)

    expect(err).toBe(controller.signal.reason)
    expect(input.reads).toBe(1)
    expect(hasChunks).not.toHaveBeenCalled()
  })
})
