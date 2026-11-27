import { Code, ConnectError } from '@connectrpc/connect'
import { createSHA256 } from 'hash-wasm'

import {
  MAX_CHUNK_SIZE_BYTES,
  MIN_CHUNK_SIZE_BYTES,
  TARGET_MAX_CHUNKS,
} from './constants.js'
import type { UploadInput } from './types.js'

/** The manifest fields CommitObject needs, computed locally before any network call. */
export interface ChunkPlan {
  sizeBytes: number
  chunkSizeBytes: number
  /** Lowercase hex SHA-256 of the whole input. */
  sha256Digest: string
  /** Lowercase hex SHA-256 of each chunk, in order. */
  chunkHashes: string[]
}

/**
 * Picks the chunk size for a file: start at 4 MiB and double until the file fits in at most
 * 256 chunks, capped at 64 MiB. Deterministic so the same file always yields the same chunks.
 */
export function chunkSizeFor(sizeBytes: number): number {
  let size = MIN_CHUNK_SIZE_BYTES
  while (size < MAX_CHUNK_SIZE_BYTES && size * TARGET_MAX_CHUNKS < sizeBytes) {
    size *= 2
  }
  return size
}

/**
 * Returns bytes [start, end) of an upload input without copying when possible. Blob slices
 * stream from disk when sent; Uint8Array views are zero-copy unless backed by SharedArrayBuffer.
 */
export function sliceInput(
  input: UploadInput,
  start: number,
  end: number,
): Blob | Uint8Array<ArrayBuffer> {
  if (input instanceof Uint8Array) {
    const view = input.subarray(start, end)
    // Web Crypto and fetch reject views over SharedArrayBuffer, so copy only in that rare case.
    return view.buffer instanceof ArrayBuffer
      ? (view as Uint8Array<ArrayBuffer>)
      : new Uint8Array(view)
  }
  return input.slice(start, end)
}

/**
 * Splits the input into chunks and hashes each chunk and the whole input in one pass.
 * Only one chunk is held in memory at a time, so multi-gigabyte Files are safe.
 */
export async function planChunks(
  input: UploadInput,
  onHashed?: (hashedBytes: number, totalBytes: number) => void,
): Promise<ChunkPlan> {
  const sizeBytes = input instanceof Uint8Array ? input.byteLength : input.size
  if (sizeBytes === 0) {
    throw new ConnectError(
      'empty files cannot be uploaded',
      Code.InvalidArgument,
    )
  }

  const chunkSizeBytes = chunkSizeFor(sizeBytes)
  const fileHasher = await createSHA256()
  fileHasher.init()
  const chunkHashes: string[] = []

  for (let pos = 0; pos < sizeBytes; pos += chunkSizeBytes) {
    const slice = sliceInput(
      input,
      pos,
      Math.min(pos + chunkSizeBytes, sizeBytes),
    )
    const bytes =
      slice instanceof Uint8Array
        ? slice
        : new Uint8Array(await slice.arrayBuffer())
    fileHasher.update(bytes)
    chunkHashes.push(await sha256Hex(bytes))
    onHashed?.(pos + bytes.byteLength, sizeBytes)
  }

  return {
    sizeBytes,
    chunkSizeBytes,
    sha256Digest: fileHasher.digest('hex'),
    chunkHashes,
  }
}

/** Computes a lowercase hex SHA-256 digest, the form the gateway uses. */
export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0')
  }
  return out
}
