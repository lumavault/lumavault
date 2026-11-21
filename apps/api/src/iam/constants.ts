// A new household gets this many seats unless the Super-Admin sets another limit.
export const DEFAULT_MEMBER_LIMIT = 4;

// The household made at first-run setup has no practical cap: the largest value the column holds.
// The Super-Admin can lower it later.
export const SETUP_STORAGE_CAP_BYTES = 2n ** 63n - 1n;

// Media apps a household can have enabled. Matches the App enum in iam.proto.
export const IAM_APPS = ["photos", "cinema", "arcade"] as const;
export type IamApp = (typeof IAM_APPS)[number];

// Secrets such as invite tokens and device secrets are stored as lowercase hex SHA-256.
export const SECRET_HASH_PATTERN = "^[0-9a-f]{64}$";

// The instance settings table holds exactly one row with this ID.
export const INSTANCE_SETTINGS_ID = 1;
