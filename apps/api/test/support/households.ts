// Test helper for creating households through Better Auth on the server. Tests only.
import { HOUSEHOLD_SLUG_PREFIX } from '#/auth/constants.js'
import type { ModuleContext } from '#/server/modules.js'

/**
 * Creates a household owned by userId, using Better Auth on the server, so the client-facing
 * organization endpoints can stay locked. The owner becomes its admin.
 */
export async function createHouseholdFor(
  ctx: ModuleContext,
  userId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const org = await ctx.auth.api.createOrganization({
    body: {
      name,
      slug: `${HOUSEHOLD_SLUG_PREFIX}${crypto.randomUUID()}`,
      userId,
    },
  })
  if (!org) {
    throw new Error('Better Auth did not create the household')
  }
  return { id: org.id, name: org.name }
}
