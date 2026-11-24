import {
  MAX_CHUNK_SIZE_BYTES,
  MIN_CHUNK_SIZE_BYTES,
  TARGET_MAX_CHUNKS,
} from '../constants.js'

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
