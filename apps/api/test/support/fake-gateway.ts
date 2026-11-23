// An in-memory Storage Gateway for tests that only need object sizes. Never imported by the server.
import { randomUUID } from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import type { StorageGateway, StoredObject } from "#/lib/storage-gateway.js";
import { APP_NAMESPACE } from "#/services/quotas/index.js";

/** Tests "commit" objects by adding them here. */
export class FakeGateway implements StorageGateway {
  objects = new Map<string, StoredObject>();
  deleted: string[] = [];

  commit(app: "photos" | "cinema" | "arcade", sizeBytes: bigint): string {
    const id = randomUUID();
    this.objects.set(id, { id, namespace: APP_NAMESPACE[app], sizeBytes, sha256Digest: "0".repeat(64) });
    return id;
  }

  async stat(objectId: string) {
    return this.objects.get(objectId) ?? null;
  }

  async delete(objectId: string) {
    this.deleted.push(objectId);
    this.objects.delete(objectId);
  }

  async setThumbnail() {}

  async copy(objectId: string) {
    const source = this.objects.get(objectId);
    if (!source) throw new ConnectError("not found", Code.NotFound);
    const id = randomUUID();
    this.objects.set(id, { ...source, id });
    return this.objects.get(id)!;
  }
}
