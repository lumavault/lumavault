// An in-memory Storage Gateway for tests that only need stat, copy, and delete.
import { randomUUID } from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import type { StorageGateway, StoredObject } from "#/services/storage-gateway.js";

export class FakeGateway implements StorageGateway {
  objects = new Map<string, StoredObject>();

  put(id: string, namespace: number, sizeBytes: bigint): void {
    this.objects.set(id, { id, namespace, sizeBytes, sha256Digest: "0".repeat(64) });
  }

  async stat(objectId: string) {
    return this.objects.get(objectId) ?? null;
  }

  async delete(objectId: string) {
    this.objects.delete(objectId);
  }

  async setThumbnail() {}

  async copy(objectId: string) {
    const source = this.objects.get(objectId);
    if (!source) throw new ConnectError("not found", Code.NotFound);
    const id = `copy-${randomUUID()}`;
    this.objects.set(id, { ...source, id });
    return this.objects.get(id)!;
  }
}
