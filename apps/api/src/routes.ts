// Every URL path the API serves or links to, in one place.

// Served by this API.
export const HEALTH_PATH = "/healthz";
export const RPC_PREFIX = "/api/rpc";

// Better Auth is mounted under this path.
export const AUTH_BASE_PATH = "/api/auth";

// Better Auth routes clients may never call. IamService does these actions server-side.
export const LOCKED_AUTH_PREFIXES = ["/organization/", "/admin/"] as const;

// Portal pages. A household creation invite link is the Portal URL, this path, and the invite's secret.
export const HOUSEHOLD_INVITE_PATH = "/invite/household/";

// A member invite link is the Portal URL, this path, and the invite's ID.
export const MEMBER_INVITE_PATH = "/invite/member/";
