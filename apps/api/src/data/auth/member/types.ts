import type { member } from "#/db/schemas/auth.js";
import type { User } from "#/data/auth/user/types.js";

/** A Better Auth organization member row. */
export type Member = typeof member.$inferSelect;

/** A household member with their user row. */
export interface MemberWithUser {
  member: Member;
  user: User;
}
