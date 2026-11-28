import { Code, ConnectError } from '@connectrpc/connect'
import { createSHA256, sha256 } from 'hash-wasm'

import { chunkSizeFor } from './chunk-size.js'
import { toByteSource, type UploadInput } from './source.js'

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
 * Splits the input into chunks and hashes each chunk and the whole input in one pass.
 * Only one chunk is held in memory at a time, so multi-gigabyte Files are safe.
 */
export async function planChunks(
  input: UploadInput,
  onHashed?: (hashedBytes: number, totalBytes: number) => void,
): Promise<ChunkPlan> {
  const source = toByteSource(input)
  if (source.size === 0) {
    throw new ConnectError(
      'empty files cannot be uploaded',
      Code.InvalidArgument,
    )
  }

  const chunkSizeBytes = chunkSizeFor(source.size)
  const fileHasher = await createSHA256()
  fileHasher.init()
  const chunkHashes: string[] = []

  for (let pos = 0; pos < source.size; pos += chunkSizeBytes) {
    const bytes = await source.read(
      pos,
      Math.min(pos + chunkSizeBytes, source.size),
    )
    fileHasher.update(bytes)
    chunkHashes.push(await sha256(bytes))
    onHashed?.(pos + bytes.byteLength, source.size)
  }

  return {
    sizeBytes: source.size,
    chunkSizeBytes,
    sha256Digest: fileHasher.digest('hex'),
    chunkHashes,
  }
}
