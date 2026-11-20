import type { DbOrTx } from "#/db/index.js";
import { iamInstanceSettings } from "#/db/schemas/iam.js";
import { INSTANCE_SETTINGS_ID } from "#/iam/constants.js";

/** Creates the single instance settings row if it is missing, so there is a row to lock. */
export async function createInstanceSettingsIfMissing(db: DbOrTx): Promise<void> {
  await db.insert(iamInstanceSettings).values({ id: INSTANCE_SETTINGS_ID }).onConflictDoNothing();
}
