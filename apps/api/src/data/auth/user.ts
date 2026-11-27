import { randomUUID } from 'node:crypto'
import {
  keysetAfter,
  keysetOrder,
  likeContains,
  type PageCursor,
} from '#/data/sql.js'
import type { DbOrTx } from '#/db/index.js'
import { user } from '#/db/schemas/auth.js'
import { and, eq, ilike, or } from 'drizzle-orm'

/** A Better Auth user row. */
export type User = typeof user.$inferSelect

/** What it takes to create an account outside Better Auth's own sign-up. */
export type NewUser = Pick<
  typeof user.$inferInsert,
  'name' | 'email' | 'role' | 'emailVerified'
>

/** Inserts a user row and returns it. The caller has already checked who may sign up. */
export async function createUser(db: DbOrTx, input: NewUser): Promise<User> {
  const [row] = await db
    .insert(user)
    .values({ id: randomUUID(), ...input })
    .returning()
  return row!
}

export async function getUserById(
  db: DbOrTx,
  userId: string,
): Promise<User | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId))
  return row ?? null
}

/** A user, locked until the transaction ends, so changes to their membership run one at a time. */
export async function getUserForUpdate(
  db: DbOrTx,
  userId: string,
): Promise<User | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .for('update')
  return row ?? null
}

/** A page of users in creation order, optionally only those whose name or email contains query, ignoring case. */
export async function getUsers(
  db: DbOrTx,
  page: { query?: string; after?: PageCursor; limit: number },
): Promise<User[]> {
  const pattern = page.query ? likeContains(page.query) : undefined
  return db
    .select()
    .from(user)
    .where(
      and(
        pattern
          ? or(ilike(user.name, pattern), ilike(user.email, pattern))
          : undefined,
        page.after
          ? keysetAfter(user.createdAt, user.id, page.after)
          : undefined,
      ),
    )
    .orderBy(...keysetOrder(user.createdAt, user.id))
    .limit(page.limit)
}
