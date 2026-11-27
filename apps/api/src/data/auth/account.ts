import { randomUUID } from 'node:crypto'
import { CREDENTIAL_PROVIDER_ID } from '#/auth/constants.js'
import type { DbOrTx } from '#/db/index.js'
import { account } from '#/db/schemas/auth.js'

/**
 * Adds an email and password sign-in to a user, shaped the way Better Auth's own sign-up
 * stores it, so Better Auth can check the password later. passwordHash comes from Better
 * Auth's own hasher.
 */
export async function createCredentialAccount(
  db: DbOrTx,
  input: { userId: string; passwordHash: string },
): Promise<void> {
  await db.insert(account).values({
    id: randomUUID(),
    accountId: input.userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    userId: input.userId,
    password: input.passwordHash,
  })
}
