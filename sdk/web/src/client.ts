import { create } from '@bufbuild/protobuf'
import { FieldMaskSchema } from '@bufbuild/protobuf/wkt'
import {
  Code,
  ConnectError,
  createClient,
  type Client,
} from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

import { AUTHORIZATION_HEADER, SERVICE_KEY_HEADER } from './constants.js'
import { chunkUrl, getChunk, getRange, streamUrl } from './dataplane.js'
import { verifiedStream } from './download.js'
import {
  ObjectMetadataSchema,
  StorageService,
  type ObjectMetadata,
} from './gen/lumavault/v1/storage_pb.js'
import type {
  DownloadOptions,
  ListOptions,
  ListPage,
  LumaVaultClientOptions,
  StreamUrlOptions,
  UpdateFields,
  UploadInput,
  UploadOptions,
  UploadResult,
} from './types.js'
import { upload } from './upload.js'

/** What a call presents to the gateway: a per-call ticket, or the client-wide service key. */
export interface Credentials {
  ticket?: string
  serviceKey?: string
}

/** Headers for one call. A ticket wins over the service key, since it is the narrower grant. */
export function authHeaders({
  ticket,
  serviceKey,
}: Credentials): Record<string, string> {
  if (ticket) {
    return { [AUTHORIZATION_HEADER]: `Bearer ${ticket}` }
  }
  if (serviceKey) {
    return { [SERVICE_KEY_HEADER]: serviceKey }
  }
  return {}
}

// Maps update() keys to the proto field paths the gateway's FieldMask expects.
const UPDATE_MASK_PATHS: Record<keyof UpdateFields, string> = {
  filename: 'filename',
  mimeType: 'mime_type',
  thumbnailChunkHash: 'thumbnail_chunk_hash',
}

/** One client per gateway. Create it once and use it for every storage call. */
export class LumaVaultClient {
  readonly #baseUrl: string
  readonly #serviceKey: string | undefined
  readonly #rpc: Client<typeof StorageService>

  constructor(options: LumaVaultClientOptions) {
    this.#baseUrl = options.baseUrl
    this.#serviceKey = options.serviceKey
    this.#rpc = createClient(
      StorageService,
      createConnectTransport({
        baseUrl: options.baseUrl,
        useBinaryFormat: true,
      }),
    )
  }

  /** Chunks, hashes, sends only missing chunks, and commits. Empty inputs are rejected. */
  async upload(
    input: UploadInput,
    options: UploadOptions,
  ): Promise<UploadResult> {
    const object = await upload(
      this.#rpc,
      this.#baseUrl,
      input,
      options,
      this.#headers(options.ticket),
    )
    return { ...object, url: this.streamUrl(object.id) }
  }

  /** Streams the object's bytes, failing with data_loss if any chunk or the whole file mismatches. */
  download(
    id: string,
    options: DownloadOptions = {},
  ): ReadableStream<Uint8Array> {
    const headers = this.#headers(options.ticket)
    return verifiedStream(
      this.get(id, options),
      (sha256, signal) => getChunk(this.#baseUrl, sha256, headers, signal),
      options.signal,
    )
  }

  /** A URL for video players, byte-range readers, and browser downloads. Not hash-checked. */
  streamUrl(id: string, ticketOrOptions?: string | StreamUrlOptions): string {
    return streamUrl(this.#baseUrl, id, ticketOrOptions)
  }

  /**
   * Reads length bytes from start, fewer at the end of the object. Not hash-checked. Fails
   * with out_of_range for an empty object or a start past the end.
   */
  readRange(
    id: string,
    start: number,
    length: number,
    options: DownloadOptions = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    return getRange(
      this.#baseUrl,
      id,
      start,
      length,
      this.#headers(options.ticket),
      options.signal,
    )
  }

  /** A URL for one chunk, for example to show it in an image element. */
  chunkUrl(sha256: string, ticket?: string): string {
    return chunkUrl(this.#baseUrl, sha256, ticket)
  }

  /** The object's thumbnail URL, or null when it has none. */
  thumbnailUrl(
    object: Pick<ObjectMetadata, 'thumbnailChunkHash'>,
    ticket?: string,
  ): string | null {
    return object.thumbnailChunkHash
      ? this.chunkUrl(object.thumbnailChunkHash, ticket)
      : null
  }

  async get(
    id: string,
    options: DownloadOptions = {},
  ): Promise<ObjectMetadata> {
    const { object } = await this.#rpc.getObject(
      { objectId: id },
      { signal: options.signal, headers: this.#headers(options.ticket) },
    )
    if (!object) {
      throw new ConnectError(
        `gateway returned no object for ${id}`,
        Code.Internal,
      )
    }
    return object
  }

  /** Changes only the fields passed; the gateway's FieldMask is built from their keys. */
  async update(id: string, fields: UpdateFields): Promise<ObjectMetadata> {
    const keys = (Object.keys(fields) as (keyof UpdateFields)[]).filter(
      (k) => fields[k] !== undefined,
    )
    const { object } = await this.#rpc.updateObjectMetadata(
      {
        object: create(ObjectMetadataSchema, { id, ...fields }),
        updateMask: create(FieldMaskSchema, {
          paths: keys.map((k) => UPDATE_MASK_PATHS[k]),
        }),
      },
      { headers: this.#headers() },
    )
    if (!object) {
      throw new ConnectError(
        `gateway returned no object for ${id}`,
        Code.Internal,
      )
    }
    return object
  }

  async delete(id: string): Promise<void> {
    await this.#rpc.deleteObject({ objectId: id }, { headers: this.#headers() })
  }

  /**
   * Makes a new object with the same bytes, billed separately by whoever commits it. The
   * gateway keeps one copy of each chunk, so this writes only a new manifest. Needs the service key.
   */
  async copy(id: string): Promise<ObjectMetadata> {
    const source = await this.get(id)
    const { object } = await this.#rpc.commitObject(
      {
        namespace: source.namespace,
        filename: source.filename,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        chunkSizeBytes: source.chunkSizeBytes,
        sha256Digest: source.sha256Digest,
        chunkHashes: source.chunkHashes,
        thumbnailChunkHash: source.thumbnailChunkHash,
        skipDedup: true,
      },
      { headers: this.#headers() },
    )
    if (!object) {
      throw new ConnectError(
        `gateway returned no object for the copy of ${id}`,
        Code.Internal,
      )
    }
    return object
  }

  /** One page of objects in a namespace. */
  async list(options: ListOptions): Promise<ListPage> {
    const res = await this.#rpc.listObjects(
      {
        namespace: options.namespace,
        pageToken: options.cursor ?? '',
        pageSize: options.limit ?? 0,
      },
      { headers: this.#headers() },
    )
    const hasMore = res.nextPageToken !== ''
    return {
      objects: res.objects,
      cursor: hasMore ? res.nextPageToken : undefined,
      hasMore,
    }
  }

  #headers(ticket?: string): Record<string, string> {
    return authHeaders({ ticket, serviceKey: this.#serviceKey })
  }

  /** Every object in a namespace, fetching pages as the loop asks for them. */
  async *listAll(
    options: Omit<ListOptions, 'cursor'>,
  ): AsyncGenerator<ObjectMetadata> {
    let cursor: string | undefined
    do {
      const page = await this.list({ ...options, cursor })
      yield* page.objects
      cursor = page.cursor
    } while (cursor)
  }
}
