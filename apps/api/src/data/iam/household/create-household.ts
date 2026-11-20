import type { DbOrTx } from "#/db/index.js";
import { iamHouseholds } from "#/db/schemas/iam.js";
import type { NewHousehold } from "./types.js";

/** Gives a household its allowance. */
export async function createHousehold(db: DbOrTx, input: NewHousehold): Promise<void> {
  await db.insert(iamHouseholds).values(input);
}
