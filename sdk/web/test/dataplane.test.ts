import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getChunk, putChunk } from "#/dataplane.js";

const BASE = "http://gw:8080";
const HASH = "a".repeat(64);

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

async function failure(p: Promise<unknown>): Promise<ConnectError> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ConnectError);
  return err as ConnectError;
}

describe("data plane errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  const cases: [number, Code][] = [
    [400, Code.InvalidArgument],
    [404, Code.NotFound],
    [413, Code.InvalidArgument],
    [401, Code.Unauthenticated],
    [403, Code.PermissionDenied],
    [500, Code.Internal],
    [503, Code.Unavailable],
  ];
  for (const [status, code] of cases) {
    it(`maps HTTP ${status} to ${Code[code]} with the gateway message`, async () => {
      respond(status, { error: "boom" });
      const err = await failure(getChunk(BASE, HASH, {}));
      expect(err.code).toBe(code);
      expect(err.rawMessage).toBe("boom");
    });
  }

  it("maps a network failure to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect((await failure(getChunk(BASE, HASH, {}))).code).toBe(Code.Unavailable);
  });

  it("rejects a PUT when the gateway stored a different size", async () => {
    respond(201, { sha256: HASH, size_bytes: 2 });
    expect((await failure(putChunk(BASE, HASH, new Uint8Array(3), {}))).code).toBe(Code.Internal);
  });

  it("accepts a PUT when the stored size matches", async () => {
    respond(201, { sha256: HASH, size_bytes: 3 });
    await expect(putChunk(BASE, HASH, new Uint8Array(3), {})).resolves.toBeUndefined();
  });
});
