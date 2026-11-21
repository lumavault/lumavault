import type { user } from "#/db/schemas/auth.js";

/** A Better Auth user row. */
export type User = typeof user.$inferSelect;

/** What it takes to create an account outside Better Auth's own sign-up. */
export type NewUser = Pick<typeof user.$inferInsert, "name" | "email" | "role" | "emailVerified">;
