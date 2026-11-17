// A new household gets this many seats unless the Super-Admin sets another limit.
export const DEFAULT_MEMBER_LIMIT = 4;

// Media apps a household can have enabled. Matches the App enum in iam.proto.
export const IAM_APPS = ["photos", "cinema", "arcade"] as const;
export type IamApp = (typeof IAM_APPS)[number];

// Secrets such as invite tokens and device secrets are stored as lowercase hex SHA-256.
export const SECRET_HASH_PATTERN = "^[0-9a-f]{64}$";

// The instance settings table holds exactly one row with this ID.
export const INSTANCE_SETTINGS_ID = 1;

// How long a removed member can still read their private data before it is deleted.
export const GRACE_PERIOD_DAYS = 30;

// The server owner's own household from first-run setup gets every app and, in effect, no cap.
// The Super-Admin can lower it later like any other household.
export const SETUP_STORAGE_CAP_BYTES = 2n ** 62n;

// Household creation invite links work once and expire after a week.
export const HOUSEHOLD_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Portal pages that invite links open. The token or invite ID follows the last slash.
export const PORTAL_HOUSEHOLD_INVITE_PATH = "/invite/household/";
export const PORTAL_MEMBER_INVITE_PATH = "/invite/member/";

// List RPCs return at most this many rows per page.
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

// Apple TV pairing codes: 6 characters from 32 with no lookalikes (no 0, 1, I, or O).
export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_POLL_INTERVAL_SECONDS = 5;
// Wrong device secrets on one pairing before it is burned.
export const PAIRING_MAX_FAILED_ATTEMPTS = 5;

// Per-IP and per-user limits, as a count per window.
export const PAIRING_RATE_WINDOW_MS = 10 * 60 * 1000;
export const PAIRING_STARTS_PER_WINDOW = 10;
export const PAIRING_POLLS_PER_WINDOW = 300;
export const PAIRING_APPROVALS_PER_WINDOW = 20;
