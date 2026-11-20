import { and, asc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import type { DbOrTx } from "#/db/index.js";
import { user } from "#/db/schemas/auth.js";

/** A user by ID, or null when there is none. */
export async function getUserById(db: DbOrTx, userId: string) {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  return row ?? null;
}

/** Any one Super-Admin, or null when the instance has none. Roles are a comma-separated list. */
export async function getSuperAdmin(db: DbOrTx): Promise<{ id: string } | null> {
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`string_to_array(coalesce(${user.role}, ''), ',') @> array[${SUPER_ADMIN_ROLE}]`)
    .limit(1);
  return admin ?? null;
}

/** One page of users in ID order. The query matches name or email anywhere, ignoring case. */
export async function listUsersAfter(db: DbOrTx, input: { query: string; afterId: string | null; limit: number }) {
  const pattern = `%${input.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select()
    .from(user)
    .where(
      and(
        input.query ? or(ilike(user.name, pattern), ilike(user.email, pattern)) : undefined,
        input.afterId ? gt(user.id, input.afterId) : undefined,
      ),
    )
    .orderBy(asc(user.id))
    .limit(input.limit);
}
