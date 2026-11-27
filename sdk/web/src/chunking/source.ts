/** Anything the SDK can upload. A File is a Blob, so it is covered too. */
export type UploadInput = Blob | Uint8Array

/** Random-access reader over an upload input that only materializes the requested range. */
export interface ByteSource {
  readonly size: number
  read(start: number, end: number): Promise<Uint8Array>
}

/**
 * Wraps a Blob or Uint8Array behind one reader so the planner and uploader never branch on the
 * input type. Blob reads load only the requested slice; Uint8Array reads are zero-copy views.
 */
export function toByteSource(input: UploadInput): ByteSource {
  if (input instanceof Uint8Array) {
    return {
      size: input.byteLength,
      read: async (start, end) => input.subarray(start, end),
    }
  }
  return {
    size: input.size,
    read: async (start, end) =>
      new Uint8Array(await input.slice(start, end).arrayBuffer()),
  }
}
