import { randomUUID } from 'node:crypto'
import type { DbOrTx } from '#/db/index.js'
import { user } from '#/db/schemas/auth.js'

import type { NewUser, User } from './types.js'

/** Inserts a user row and returns it. The caller has already checked who may sign up. */
export async function createUser(db: DbOrTx, input: NewUser): Promise<User> {
  const [row] = await db
    .insert(user)
    .values({ id: randomUUID(), ...input })
    .returning()
  return row!
}
