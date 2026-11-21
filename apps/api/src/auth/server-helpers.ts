import type { ModuleContext } from "#/server/modules.js";
import { HOUSEHOLD_SLUG_PREFIX } from "./constants.js";

/**
 * Creates a household owned by userId, using Better Auth on the server, so the client-facing
 * organization endpoints can stay locked. The owner becomes its admin.
 */
export async function createHouseholdFor(ctx: ModuleContext, userId: string, name: string): Promise<{ id: string; name: string }> {
  const org = await ctx.auth.api.createOrganization({
    body: { name, slug: `${HOUSEHOLD_SLUG_PREFIX}${crypto.randomUUID()}`, userId },
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
