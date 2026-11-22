import type { invitation } from "#/db/schemas/auth.js";

/** A Better Auth member invitation row. */
export type Invitation = typeof invitation.$inferSelect;

/** What it takes to invite someone into a household. */
export type NewInvitation = Pick<typeof invitation.$inferInsert, "organizationId" | "email" | "role" | "expiresAt" | "inviterId">;
