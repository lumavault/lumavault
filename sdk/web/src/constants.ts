// Chunk sizing bounds. These must match the Swift SDK and sdk/testdata/chunk-vectors.json,
// or identical files uploaded from different clients stop sharing chunks.
export const MIN_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
export const MAX_CHUNK_SIZE_BYTES = 64 * 1024 * 1024;
export const TARGET_MAX_CHUNKS = 256;

// Chunk uploads in flight at once. Browsers allow 6 connections per host, so 4 leaves
// room for RPCs and video streams running alongside an upload.
export const DEFAULT_UPLOAD_CONCURRENCY = 4;

// Gateway data plane routes, relative to the gateway base URL.
export const CHUNKS_PATH = "v1/chunks/";
export const STREAM_PATH = "v1/stream/";
export const RANGE_HEADER = "Range";
export const RANGE_BYTES_PREFIX = "bytes=";

// Storage ticket credentials. Tickets go in Authorization as a Bearer token, or in the
// token query parameter on URLs handed to video and image elements. The service key is for
// apps/api only and must never reach a browser.
export const AUTHORIZATION_HEADER = "Authorization";
export const SERVICE_KEY_HEADER = "X-LumaVault-Service-Key";
export const TOKEN_QUERY_PARAM = "token";
