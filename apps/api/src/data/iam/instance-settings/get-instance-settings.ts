import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamInstanceSettings } from "#/db/schemas/iam.js";
import { INSTANCE_SETTINGS_ID } from "#/iam/constants.js";

/** The single instance settings row, or null before first-run setup creates it. */
export async function getInstanceSettings(db: DbOrTx) {
  const [settings] = await db.select().from(iamInstanceSettings).where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID));
  return settings ?? null;
}

/** The single instance settings row, locked until the transaction ends. */
export async function getInstanceSettingsForUpdate(db: DbOrTx) {
  const [settings] = await db
    .select()
    .from(iamInstanceSettings)
    .where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID))
    .for("update");
  return settings ?? null;
}
