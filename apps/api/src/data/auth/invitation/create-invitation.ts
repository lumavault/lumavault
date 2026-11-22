import { randomUUID } from "node:crypto";
import type { DbOrTx } from "#/db/index.js";
import { invitation } from "#/db/schemas/auth.js";
import type { Invitation, NewInvitation } from "./types.js";

export async function createInvitation(db: DbOrTx, input: NewInvitation): Promise<Invitation> {
  const [row] = await db
    .insert(invitation)
    .values({ id: randomUUID(), status: "pending", ...input })
    .returning();
  if (!row) {
    throw new Error("invitation insert returned no row");
  }
  return row;
}
