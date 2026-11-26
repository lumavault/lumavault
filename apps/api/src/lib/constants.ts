// Page sizes for list calls. A request for more than the maximum gets the maximum.
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

// Leading bytes inspected to identify a stored media file's container format.
export const MEDIA_CONTAINER_HEAD_BYTES = 512

// Retry and backoff defaults for outbound HTTP requests.
export const DEFAULT_HTTP_MAX_RETRIES = 3
export const DEFAULT_HTTP_INITIAL_BACKOFF_MS = 250
export const DEFAULT_HTTP_MAX_BACKOFF_MS = 5_000
