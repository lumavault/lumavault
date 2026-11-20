import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamInstanceSettings } from "#/db/schemas/iam.js";
import { INSTANCE_SETTINGS_ID } from "#/iam/constants.js";

/** Records that first-run setup finished. */
export async function markSetupCompleted(db: DbOrTx): Promise<void> {
  await db.update(iamInstanceSettings).set({ setupCompletedAt: new Date() }).where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID));
}
