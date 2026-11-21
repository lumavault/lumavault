import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamInstanceSettings } from "#/db/schemas/iam.js";
import { INSTANCE_SETTINGS_ID } from "#/iam/constants.js";
import type { InstanceSettings } from "./types.js";

/** The single instance settings row, or null before anything has created it. */
export async function getInstanceSettings(db: DbOrTx): Promise<InstanceSettings | null> {
  const [row] = await db.select().from(iamInstanceSettings).where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID));
  return row ?? null;
}

/** The single instance settings row, locked until the transaction ends. */
export async function getInstanceSettingsForUpdate(db: DbOrTx): Promise<InstanceSettings | null> {
  const [row] = await db
    .select()
    .from(iamInstanceSettings)
    .where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID))
    .for("update");
  return row ?? null;
}
