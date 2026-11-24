import { create } from '@bufbuild/protobuf'
import type { Client } from '@connectrpc/connect'
import { Code, ConnectError } from '@connectrpc/connect'

import { planChunks, type ChunkPlan } from './chunking/plan.js'
import { forEachConcurrent } from './concurrency.js'
import { DEFAULT_UPLOAD_CONCURRENCY } from './constants.js'
import { putChunk } from './dataplane.js'
import {
  CommitObjectRequestSchema,
  type ObjectMetadata,
  type StorageService,
} from './gen/lumavault/v1/storage_pb.js'
import type { UploadInput, UploadOptions, UploadProgress } from './types.js'

/**
 * Uploads input in one call: plan locally, ask which chunks are missing, upload only those,
 * then commit. CommitObject is never retried here; a lost response would create a duplicate.
 */
export async function upload(
  rpc: Client<typeof StorageService>,
  baseUrl: string,
  input: UploadInput,
  options: UploadOptions,
  headers: Record<string, string>,
): Promise<ObjectMetadata> {
  const filename =
    options.filename ??
    (typeof File !== 'undefined' && input instanceof File
      ? input.name
      : undefined)
  if (!filename) {
    throw new ConnectError(
      'filename is required when uploading a Blob or Uint8Array',
      Code.InvalidArgument,
    )
  }
  const mimeType = options.mimeType ?? (input instanceof Blob ? input.type : '')
  const report = progressReporter(options.onProgress)
  const signal = options.signal

  const plan = await planChunks(input, (loaded, total) =>
    report('hashing', loaded, total),
  )
  signal?.throwIfAborted()

  const { missingChunkHashes } = await rpc.hasChunks(
    { chunkHashes: plan.chunkHashes },
    { signal, headers },
  )
  const missing = new Set(missingChunkHashes)
  const toSend = uniqueChunkIndexes(plan).filter((i) =>
    missing.has(plan.chunkHashes[i] as string),
  )

  // Chunks the gateway already has count as loaded straight away.
  let loaded =
    plan.sizeBytes - toSend.reduce((sum, i) => sum + chunkLength(plan, i), 0)
  report('uploading', loaded, plan.sizeBytes)
  await forEachConcurrent(
    toSend,
    options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY,
    async (i) => {
      await putChunk(
        baseUrl,
        plan.chunkHashes[i] as string,
        chunkBody(input, plan, i),
        headers,
        signal,
      )
      loaded += chunkLength(plan, i)
      report('uploading', loaded, plan.sizeBytes)
    },
  )

  const res = await rpc.commitObject(
    create(CommitObjectRequestSchema, {
      namespace: options.namespace,
      filename,
      mimeType,
      sizeBytes: BigInt(plan.sizeBytes),
      chunkSizeBytes: plan.chunkSizeBytes,
      sha256Digest: plan.sha256Digest,
      chunkHashes: plan.chunkHashes,
      skipDedup: true,
    }),
    { signal, headers },
  )
  if (!res.object) {
    throw new ConnectError(
      'gateway returned no object for CommitObject',
      Code.Internal,
    )
  }
  return res.object
}

// A file can repeat the same chunk, such as runs of zeros; send each distinct hash once.
function uniqueChunkIndexes(plan: ChunkPlan): number[] {
  const seen = new Set<string>()
  return plan.chunkHashes.flatMap((hash, i) =>
    seen.has(hash) ? [] : (seen.add(hash), [i]),
  )
}

function chunkLength(plan: ChunkPlan, index: number): number {
  return Math.min(
    plan.chunkSizeBytes,
    plan.sizeBytes - index * plan.chunkSizeBytes,
  )
}

// Blob slices stream from disk when sent, so parallel uploads hold almost nothing in memory.
function chunkBody(
  input: UploadInput,
  plan: ChunkPlan,
  index: number,
): Blob | Uint8Array<ArrayBuffer> {
  const start = index * plan.chunkSizeBytes
  const end = start + chunkLength(plan, index)
  if (input instanceof Blob) {
    return input.slice(start, end)
  }
  const view = input.subarray(start, end)
  return view.buffer instanceof ArrayBuffer
    ? (view as Uint8Array<ArrayBuffer>)
    : new Uint8Array(view)
}

function progressReporter(onProgress?: (p: UploadProgress) => void) {
  return (phase: UploadProgress['phase'], loaded: number, total: number) =>
    onProgress?.({
      phase,
      loaded,
      total,
      percentage: total === 0 ? 100 : (loaded / total) * 100,
    })
}
