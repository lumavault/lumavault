import { createHash } from "node:crypto";
import { Code, ConnectError, LumaVaultClient, Namespace } from "@lumavault/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signUploadTicket } from "#/auth/tickets.js";
import { TEST_ENV } from "#/testing/context.js";
import { startTestGateway, type TestGateway } from "#/testing/gateway.js";
import { createStorageGateway, type StorageGateway } from "./storage-gateway.js";

let gw: TestGateway;
let storage: StorageGateway;

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function uploadObject(bytes: Uint8Array) {
  const { ticket } = signUploadTicket(TEST_ENV.LUMAVAULT_TICKET_SECRET, {
    namespace: Namespace.PHOTOS,
    maxSizeBytes: BigInt(bytes.length),
  });
  const client = new LumaVaultClient({ baseUrl: gw.baseUrl });
  return client.upload(bytes, { namespace: Namespace.PHOTOS, filename: "a.jpg", ticket });
}

async function putChunk(bytes: Uint8Array): Promise<string> {
  const hash = sha(bytes);
  const res = await fetch(`${gw.baseUrl}/v1/chunks/${hash}`, {
    method: "PUT",
    body: bytes,
    headers: { "X-LumaVault-Service-Key": TEST_ENV.LUMAVAULT_SERVICE_KEY },
  });
  expect(res.status).toBe(201);
  return hash;
}

beforeAll(async () => {
  gw = await startTestGateway();
  storage = createStorageGateway({ baseUrl: gw.baseUrl, serviceKey: TEST_ENV.LUMAVAULT_SERVICE_KEY });
}, 120_000);

afterAll(() => gw?.stop());

describe("StorageGateway against a Gateway with ticket checks on", () => {
  it("reads an object's namespace and size", async () => {
    const bytes = new Uint8Array(1234).fill(7);
    const obj = await uploadObject(bytes);
    expect(await storage.stat(obj.id)).toEqual({
      id: obj.id,
      namespace: Namespace.PHOTOS,
      sizeBytes: 1234n,
      sha256Digest: sha(bytes),
    });
  });

  it("returns null for an object that does not exist", async () => {
    expect(await storage.stat("no-such-object")).toBeNull();
  });

  it("sets a thumbnail that is already uploaded", async () => {
    const obj = await uploadObject(new Uint8Array(10).fill(1));
    const thumb = await putChunk(new Uint8Array([9, 9, 9]));
    await storage.setThumbnail(obj.id, thumb);
    const admin = new LumaVaultClient({ baseUrl: gw.baseUrl, serviceKey: TEST_ENV.LUMAVAULT_SERVICE_KEY });
    expect((await admin.get(obj.id)).thumbnailChunkHash).toBe(thumb);
  });

  it("deletes an object, and deleting it again succeeds", async () => {
    const obj = await uploadObject(new Uint8Array(10).fill(2));
    await storage.delete(obj.id);
    expect(await storage.stat(obj.id)).toBeNull();
    await expect(storage.delete(obj.id)).resolves.toBeUndefined();
  });

  it("copies an object into a new one with the same bytes", async () => {
    const bytes = new Uint8Array(500).fill(4);
    const obj = await uploadObject(bytes);
    const copy = await storage.copy(obj.id);
    expect(copy.id).not.toBe(obj.id);
    expect(copy).toMatchObject({ namespace: Namespace.PHOTOS, sizeBytes: 500n, sha256Digest: sha(bytes) });
    await storage.delete(obj.id);
    expect(await storage.stat(copy.id)).not.toBeNull();
  });

  it("is rejected without the right service key", async () => {
    const wrong = createStorageGateway({ baseUrl: gw.baseUrl, serviceKey: "not-the-key" });
    const err = await wrong.stat("anything").catch((e: unknown) => e);
    expect(ConnectError.from(err).code).toBe(Code.Unauthenticated);
  });
});
