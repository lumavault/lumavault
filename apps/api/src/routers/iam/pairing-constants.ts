// Apple TV pairing codes: 6 characters from 32 with no lookalikes (no 0, 1, I, or O).
export const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const PAIRING_CODE_LENGTH = 6
export const PAIRING_TTL_MS = 10 * 60 * 1000
export const PAIRING_POLL_INTERVAL_SECONDS = 5
export const PAIRING_DEVICE_NAME_MAX_LENGTH = 100
// Polls with a wrong device secret before the pairing is burned.
export const PAIRING_MAX_FAILED_ATTEMPTS = 5
// A new code that collides with a pending one is redrawn this many times before giving up.
export const PAIRING_CODE_DRAWS = 5

// Pairing rate limits, as a count per window: starts and polls per IP, approvals per user.
// A TV polling every 5 seconds uses 120 polls per window.
export const PAIRING_RATE_WINDOW_MS = 10 * 60 * 1000
export const PAIRING_STARTS_PER_WINDOW = 10
export const PAIRING_POLLS_PER_WINDOW = 300
export const PAIRING_APPROVALS_PER_WINDOW = 20
