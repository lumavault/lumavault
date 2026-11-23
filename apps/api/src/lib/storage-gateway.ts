import { Code, ConnectError, LumaVaultClient, type ObjectMetadata } from "@lumavault/sdk";

/** What the API needs to know about a stored object to bill it. */
export interface StoredObject {
  id: string;
  /** Storage Namespace enum value. */
  namespace: number;
  sizeBytes: bigint;
  sha256Digest: string;
}

/**
 * The API's server-to-server view of the Storage Gateway. Every call carries the internal
 * service key, so it can read, update, and delete any object.
 */
export interface StorageGateway {
  /** The object, or null when the Gateway has no such object. */
  stat(objectId: string): Promise<StoredObject | null>;
  /** Deletes an object's manifest. Deleting an object that is already gone succeeds. */
  delete(objectId: string): Promise<void>;
  /** Points an object at a thumbnail chunk that is already uploaded. */
  setThumbnail(objectId: string, chunkSha256: string): Promise<void>;
}

export function createStorageGateway(options: { baseUrl: string; serviceKey: string }): StorageGateway {
  const client = new LumaVaultClient({ baseUrl: options.baseUrl, serviceKey: options.serviceKey });
  return {
    async stat(objectId) {
      try {
        return toStored(await client.get(objectId));
      } catch (err) {
        if (ConnectError.from(err).code === Code.NotFound) {
          return null;
        }
        throw err;
      }
    },
    async delete(objectId) {
      try {
        await client.delete(objectId);
      } catch (err) {
        if (ConnectError.from(err).code !== Code.NotFound) {
          throw err;
        }
      }
    },
    async setThumbnail(objectId, chunkSha256) {
      await client.update(objectId, { thumbnailChunkHash: chunkSha256 });
    },
  };
}

function toStored(o: ObjectMetadata): StoredObject {
  return { id: o.id, namespace: o.namespace, sizeBytes: o.sizeBytes, sha256Digest: o.sha256Digest };
}
