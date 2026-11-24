/** Encodes bytes as lowercase hex, the form the gateway uses for SHA-256 digests. */
export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0')
  }
  return out
}
