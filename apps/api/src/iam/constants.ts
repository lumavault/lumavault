// A new household gets this many seats unless the Super-Admin sets another limit.
export const DEFAULT_MEMBER_LIMIT = 4;

// The largest storage cap the bigint column holds.
export const MAX_STORAGE_CAP_BYTES = 2n ** 63n - 1n;

// The household made at first-run setup has no practical cap. The Super-Admin can lower it later.
export const SETUP_STORAGE_CAP_BYTES = MAX_STORAGE_CAP_BYTES;

// The largest member limit the integer column holds.
export const MAX_MEMBER_LIMIT = 2 ** 31 - 1;

// A household creation invite can be redeemed for this long.
export const HOUSEHOLD_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Media apps a household can have enabled. Matches the App enum in iam.proto.
export const IAM_APPS = ["photos", "cinema", "arcade"] as const;
export type IamApp = (typeof IAM_APPS)[number];

// Secrets such as invite tokens and device secrets are stored as lowercase hex SHA-256.
export const SECRET_HASH_PATTERN = "^[0-9a-f]{64}$";

// The instance settings table holds exactly one row with this ID.
export const INSTANCE_SETTINGS_ID = 1;
