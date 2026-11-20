import type { DbOrTx } from "#/db/index.js";
import { iamHouseholdInvites } from "#/db/schemas/iam.js";
import type { HouseholdInvite, NewHouseholdInvite } from "./types.js";

/** Stores a new invite and returns the saved row. */
export async function createHouseholdInvite(db: DbOrTx, input: NewHouseholdInvite): Promise<HouseholdInvite> {
  const [row] = await db.insert(iamHouseholdInvites).values(input).returning();
  return row!;
}
