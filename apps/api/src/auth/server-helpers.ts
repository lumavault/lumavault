import type { ModuleContext } from '#/server/modules.js'

/** Starts a new session for an approved Apple TV and returns its bearer token. */
export async function mintBearerSession(
  ctx: ModuleContext,
  userId: string,
): Promise<string> {
  const auth = await ctx.auth.$context
  const created = await auth.internalAdapter.createSession(userId, false)
  if (!created) {
    throw new Error('Better Auth did not create a session')
  }
  return created.token
}
