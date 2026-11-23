import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Code, ConnectError, LumaVaultClient, Namespace, type UploadProgress } from "#/index.js";
import { startGateway, type TestGateway } from "#test/support/gateway.js";
import { patternBytes } from "#test/support/vectors.js";

const MIB = 1024 * 1024;

describe("LumaVaultClient against a real gateway", () => {
  let gateway: TestGateway;
  let client: LumaVaultClient;

  beforeAll(async () => {
    gateway = await startGateway();
    client = new LumaVaultClient({ baseUrl: gateway.baseUrl });
  }, 120_000);
  afterAll(() => gateway?.stop());

  async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  it("uploads, downloads identical bytes, and reports progress", async () => {
    const bytes = patternBytes(0, 9 * MIB);
    const events: UploadProgress[] = [];
    const obj = await client.upload(new File([bytes], "movie.bin", { type: "video/mp4" }), {
      namespace: Namespace.CINEMA,
      onProgress: (p) => events.push(p),
    });

    expect(obj.filename).toBe("movie.bin");
    expect(obj.mimeType).toBe("video/mp4");
    expect(obj.chunkHashes).toHaveLength(3);
    expect(obj.url).toBe(client.streamUrl(obj.id));
    expect(await readAll(client.download(obj.id))).toEqual(bytes);

    expect(events[0]?.phase).toBe("hashing");
    expect(events.at(-1)).toEqual({ phase: "uploading", loaded: 9 * MIB, total: 9 * MIB, percentage: 100 });
  }, 30_000); // Hashing and moving 9 MiB can pass 5s on shared CI runners.

  it("re-uploading the same bytes sends no chunks and creates a new object", async () => {
    const bytes = patternBytes(7, 5 * MIB);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const putCount = () => fetchSpy.mock.calls.filter(([, init]) => init?.method === "PUT").length;

    const first = await client.upload(bytes, { namespace: Namespace.PHOTOS, filename: "a.jpg" });
    expect(putCount()).toBe(2);
    fetchSpy.mockClear();

    const events: UploadProgress[] = [];
    const second = await client.upload(bytes, { namespace: Namespace.PHOTOS, filename: "a.jpg", onProgress: (p) => events.push(p) });
    const puts = putCount();
    fetchSpy.mockRestore();

    expect(puts).toBe(0);
    expect(second.id).not.toBe(first.id);
    expect(events.find((e) => e.phase === "uploading")?.percentage).toBe(100);
  });

  it("requires a filename for a plain Blob", async () => {
    const err = await client.upload(new Blob([patternBytes(0, 10)]), { namespace: Namespace.GAMES }).catch((e: unknown) => e);
    expect((err as ConnectError).code).toBe(Code.InvalidArgument);
  });

  it("gets, updates, lists, and deletes", async () => {
    const created = await Promise.all(
      [1, 2, 3].map((n) => client.upload(patternBytes(n, 100 + n), { namespace: Namespace.GAMES, filename: `save${n}.sav` })),
    );
    const ids = created.map((o) => o.id);

    const updated = await client.update(ids[0]!, { filename: "renamed.sav" });
    expect(updated.filename).toBe("renamed.sav");
    expect((await client.get(ids[0]!)).filename).toBe("renamed.sav");

    const page = await client.list({ namespace: Namespace.GAMES, limit: 2 });
    expect(page.objects).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBeTruthy();

    const all: string[] = [];
    for await (const o of client.listAll({ namespace: Namespace.GAMES, limit: 2 })) all.push(o.id);
    expect(all).toEqual(expect.arrayContaining(ids));

    await client.delete(ids[1]!);
    const err = await client.get(ids[1]!).catch((e: unknown) => e);
    expect((err as ConnectError).code).toBe(Code.NotFound);
  });
});
