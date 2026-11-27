import type { UploadInput } from './chunking/source.js'
import type {
  Namespace,
  ObjectMetadata,
} from './gen/lumavault/v1/storage_pb.js'

export type { UploadInput }

export interface LumaVaultClientOptions {
  /** Storage Gateway base URL, for example http://localhost:8080. */
  baseUrl: string
  /**
   * The gateway's internal service key, sent on every call. Server-side code in apps/api
   * only; never set this in a browser or app.
   */
  serviceKey?: string
}

export interface UploadProgress {
  /** Hashing runs over the whole file first, then missing chunks are uploaded. */
  phase: 'hashing' | 'uploading'
  loaded: number
  total: number
  /** loaded / total as a number from 0 to 100. */
  percentage: number
}

export interface UploadOptions {
  namespace: Namespace
  /** Defaults to the File name. Required for a plain Blob or Uint8Array. */
  filename?: string
  /** Defaults to the Blob type. */
  mimeType?: string
  /** Chunk uploads in flight at once. Defaults to 4. */
  concurrency?: number
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
  /** Upload ticket from IamService.PrepareUpload. */
  ticket?: string
}

/** The committed object plus a URL that streams it. */
export type UploadResult = ObjectMetadata & { url: string }

export interface DownloadOptions {
  signal?: AbortSignal
  /** Read ticket for this object, from the app's API. */
  ticket?: string
}

export interface UpdateFields {
  filename?: string
  mimeType?: string
  thumbnailChunkHash?: string
}
