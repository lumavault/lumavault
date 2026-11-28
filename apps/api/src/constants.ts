export const DEFAULT_PORT = 4000

// Connect messages larger than this are rejected before they reach a handler.
export const RPC_READ_MAX_BYTES = 1 << 20

// HMAC keys shorter than this are refused outside tests.
export const MIN_SECRET_BYTES = 32

// How long shutdown waits for open requests before closing the database anyway.
export const SHUTDOWN_TIMEOUT_MS = 10_000

// Folders under src whose files may export a module to load at startup.
export const MODULE_DIRS = ['auth', 'routers', 'workers'] as const

export const CORS_ALLOW_METHODS = ['GET', 'POST', 'OPTIONS']
export const CORS_ALLOW_HEADERS = [
  'Authorization',
  'Content-Type',
  'Connect-Protocol-Version',
  'Connect-Timeout-Ms',
  'Connect-Accept-Encoding',
  'Connect-Content-Encoding',
]
export const CORS_EXPOSE_HEADERS = [
  'Connect-Content-Encoding',
  'Set-Auth-Token',
]

// Client address used for rate limits when the server cannot tell who is calling.
export const UNKNOWN_CLIENT_IP = 'unknown'

// Lowercase hex SHA-256 digest format, used for chunk hashes and stored secret hashes.
export const SHA256_HEX = /^[0-9a-f]{64}$/
