// Better Auth is mounted here on the API server.
export const AUTH_BASE_PATH = "/api/auth";

// Portal routes the sign-in flow sends people to.
export const PORTAL_LOGIN_PATH = "/login";
export const PORTAL_HOME_PATH = "/";
export const RETURN_TO_PARAM = "returnTo";

// Sent with sign-up from a household creation invite link; the API's sign-up gate reads it.
export const INVITE_TOKEN_HEADER = "X-LumaVault-Invite";

export const MIN_PASSWORD_LENGTH = 8;
