import { createSHA256, sha256 } from 'hash-wasm'

import { getChunk } from './dataplane.js'
import { hashMismatch } from './errors.js'
import type { ObjectMetadata } from './gen/lumavault/v1/storage_pb.js'

export type ChunkFetcher = (
  sha256: string,
  signal?: AbortSignal,
) => Promise<Uint8Array<ArrayBuffer>>

/** Fetches chunks over the data plane with the given credential headers. */
export function gatewayChunkFetcher(
  baseUrl: string,
  headers: Record<string, string>,
): ChunkFetcher {
  return (sha256, signal) => getChunk(baseUrl, sha256, headers, signal)
}

/**
 * Streams an object's bytes, fetching one chunk only when the reader asks for more.
 * Each chunk is checked before it is passed on, and the whole file is checked at the end.
 */
export function verifiedStream(
  object: Promise<ObjectMetadata>,
  fetchChunk: ChunkFetcher,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  let meta: ObjectMetadata
  let fileHasher: Awaited<ReturnType<typeof createSHA256>>
  let index = 0

  return new ReadableStream<Uint8Array>(
    {
      async start() {
        meta = await object
        fileHasher = await createSHA256()
        fileHasher.init()
      },
      async pull(controller) {
        if (index === meta.chunkHashes.length) {
          if (fileHasher.digest('hex') !== meta.sha256Digest) {
            throw hashMismatch(`object ${meta.id}`)
          }
          controller.close()
          return
        }
        const expected = meta.chunkHashes[index] as string
        const bytes = await fetchChunk(expected, signal)
        if ((await sha256(bytes)) !== expected) {
          throw hashMismatch(`chunk ${index} of object ${meta.id}`)
        }
        fileHasher.update(bytes)
        index++
        controller.enqueue(bytes)
      },
    },
    { highWaterMark: 0 },
  )
}
