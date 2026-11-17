import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, magicLink, organization } from "better-auth/plugins";
import type { Db } from "#/db/index.js";
import {
  AUTH_BASE_PATH,
  DEFAULT_USER_ROLE,
  HOUSEHOLD_OWNER_ROLE,
  PASSKEY_RP_NAME,
  SUPER_ADMIN_ROLE,
} from "./constants.js";
import { householdAccess, householdRoles } from "./roles.js";
import { joinFromMemberInvite, signUpReason } from "./sign-up-gate.js";

export interface MagicLinkMessage {
  email: string;
  url: string;
  token: string;
}

export interface AuthDeps {
  db: Db;
  /** Drizzle tables Better Auth reads and writes, from src/db/schemas/auth.ts. */
  tables: Record<string, unknown>;
  secret: string;
  /** Public origin of this API server, for example http://localhost:4000. */
  baseURL: string;
  /** Web app origins allowed to call Better Auth with cookies. */
  trustedOrigins: string[];
  /** Hostname passkeys are bound to, shared by every web app, for example localhost. */
  passkeyRpID: string;
  /** Sends a magic-link email through the mailer. */
  sendMagicLink: (message: MagicLinkMessage) => Promise<void>;
  /** Sends a password reset email through the mailer. */
  sendPasswordReset: (message: { email: string; url: string }) => Promise<void>;
  /**
   * Parent domain for session cookies, for example example.com, when the web apps and API
   * live on different subdomains. Unset keeps cookies on the API host, which already works
   * for every web app because they all call the same API.
   */
  cookieDomain?: string;
}

/** Builds the Better Auth instance. Client access to household endpoints is locked in org-lockdown.ts. */
export function createAuth(deps: AuthDeps) {
  return betterAuth({
    secret: deps.secret,
    baseURL: deps.baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: deps.trustedOrigins,
    database: drizzleAdapter(deps.db, { provider: "pg", schema: deps.tables }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: ({ user, url }) => deps.sendPasswordReset({ email: user.email, url }),
      revokeSessionsOnPasswordReset: true,
    },
    // No cookie cache: every request reads the session row, so bans and revocations apply at once.
    session: { cookieCache: { enabled: false } },
    advanced: deps.cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: deps.cookieDomain } } : {},
    // Sign-up is invite-only, matched by the invited email. This runs for every new account,
    // including one a magic link creates. Member invites become memberships right away.
    databaseHooks: {
      user: {
        create: {
          async before(newUser) {
            if (!(await signUpReason(deps.db, newUser.email))) {
              throw new APIError("FORBIDDEN", { message: "sign-up is by invite only" });
            }
          },
          async after(newUser) {
            await joinFromMemberInvite(deps.db, newUser.id, newUser.email);
          },
        },
      },
    },
    plugins: [
      passkey({ rpID: deps.passkeyRpID, rpName: PASSKEY_RP_NAME, origin: deps.trustedOrigins }),
      magicLink({ sendMagicLink: (message) => deps.sendMagicLink(message) }),
      bearer(),
      admin({ adminRoles: [SUPER_ADMIN_ROLE], defaultRole: DEFAULT_USER_ROLE }),
      organization({ ac: householdAccess, roles: householdRoles, creatorRole: HOUSEHOLD_OWNER_ROLE }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
