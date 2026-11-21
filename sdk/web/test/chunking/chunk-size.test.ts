import { describe, expect, it } from "vitest";
import { loadVectors } from "#test/support/vectors.js";
import { chunkSizeFor } from "#/chunking/chunk-size.js";

describe("chunkSizeFor", () => {
  for (const { sizeBytes, chunkSizeBytes } of loadVectors().chunkSizeRule) {
    it(`picks ${chunkSizeBytes} bytes for a ${sizeBytes}-byte file`, () => {
      expect(chunkSizeFor(sizeBytes)).toBe(chunkSizeBytes);
    });
  }
});
