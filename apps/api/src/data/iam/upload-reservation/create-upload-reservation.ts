import type { DbOrTx } from "#/db/index.js";
import { iamUploadReservations } from "#/db/schemas/iam.js";
import type { NewUploadReservation } from "./types.js";

/** Inserts a pending reservation and returns its ID. */
export async function createUploadReservation(db: DbOrTx, input: NewUploadReservation): Promise<string> {
  const [row] = await db.insert(iamUploadReservations).values(input).returning({ id: iamUploadReservations.id });
  return row!.id;
}
