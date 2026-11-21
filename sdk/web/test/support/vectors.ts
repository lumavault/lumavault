import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface FileVector {
  name: string;
  sizeBytes: number;
  chunkSizeBytes: number;
  sha256: string;
  chunkHashes: string[];
}

export interface ChunkVectors {
  chunkSizeRule: { sizeBytes: number; chunkSizeBytes: number }[];
  files: FileVector[];
}

const PATTERN_MODULUS = 251;

/** Loads the cross-SDK vectors shared with the Swift tests. */
export function loadVectors(): ChunkVectors {
  const path = fileURLToPath(new URL("../../../testdata/chunk-vectors.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as ChunkVectors;
}

/** Bytes [start, start+length) of the vector pattern, where byte i is i mod 251. */
export function patternBytes(start: number, length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (start + i) % PATTERN_MODULUS;
  }
  return out;
}
