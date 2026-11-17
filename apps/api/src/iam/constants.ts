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
