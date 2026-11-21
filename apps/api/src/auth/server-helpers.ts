import { setUserRole } from "#/data/auth/user/update-user.js";
import type { ModuleContext } from "#/server/modules.js";
import { SUPER_ADMIN_ROLE } from "./constants.js";
import { allowSignUp } from "./sign-up-gate.js";

export interface NewAccount {
  name: string;
  email: string;
  password: string;
}

export interface CreatedAdmin {
  userId: string;
  /** Session token, usable as a bearer token. */
  token: string;
  /** Set-Cookie headers that sign the browser in, to forward on the RPC response. */
  setCookie: string[];
}

/** Creates the first account past the sign-up gate and makes it the Super-Admin. */
export async function createFirstAdmin(ctx: ModuleContext, account: NewAccount): Promise<CreatedAdmin> {
  const res = await allowSignUp(() =>
    ctx.auth.api.signUpEmail({ body: account, returnHeaders: true }),
  );
  const userId = res.response.user.id;
  const token = res.response.token;
  if (!token) {
    throw new Error("sign-up returned no session");
  }
  await setUserRole(ctx.db, userId, SUPER_ADMIN_ROLE);
  return { userId, token, setCookie: res.headers.getSetCookie() };
}

/**
 * Creates a household owned by userId, using Better Auth on the server, so the client-facing
 * organization endpoints can stay locked. The owner becomes its admin.
 */
export async function createHouseholdFor(ctx: ModuleContext, userId: string, name: string): Promise<{ id: string; name: string }> {
  const org = await ctx.auth.api.createOrganization({
    body: { name, slug: `household-${crypto.randomUUID()}`, userId },
  });
  if (!org) {
    throw new Error("Better Auth did not create the household");
  }
  return { id: org.id, name: org.name };
}

/** Starts a new session for an approved Apple TV and returns its bearer token. */
export async function mintBearerSession(ctx: ModuleContext, userId: string): Promise<string> {
  const auth = await ctx.auth.$context;
  const created = await auth.internalAdapter.createSession(userId, false);
  if (!created) {
    throw new Error("Better Auth did not create a session");
  }
  return created.token;
}
