import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { AUTH_BASE_PATH } from "./constants.js";

/**
 * The browser's Better Auth client: email and password, passkeys, and magic links, with the
 * session cookie sent cross-origin. Household and admin actions are not here; they go
 * through IamService. Ported from the sweetbeasts-turbo client factory.
 */
export function createLumaVaultAuthClient(apiUrl: string) {
  return createAuthClient({
    baseURL: apiUrl,
    basePath: AUTH_BASE_PATH,
    fetchOptions: { credentials: "include" },
    plugins: [passkeyClient(), magicLinkClient()],
  });
}

export type LumaVaultAuthClient = ReturnType<typeof createLumaVaultAuthClient>;
