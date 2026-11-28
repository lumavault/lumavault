import type { DbOrTx } from '#/db/index.js'
import { iamInstanceSettings } from '#/db/schemas/iam.js'
import { INSTANCE_SETTINGS_ID } from '#/iam/constants.js'
import { eq } from 'drizzle-orm'

/** The single instance settings row. */
export type InstanceSettings = typeof iamInstanceSettings.$inferSelect

/** Creates the single instance settings row if it is missing, so there is always a row to lock. */
export async function createInstanceSettingsIfMissing(
  db: DbOrTx,
): Promise<void> {
  await db
    .insert(iamInstanceSettings)
    .values({ id: INSTANCE_SETTINGS_ID })
    .onConflictDoNothing()
}

/** The single instance settings row, or null before anything has created it. */
export async function getInstanceSettings(
  db: DbOrTx,
): Promise<InstanceSettings | null> {
  const [row] = await db
    .select()
    .from(iamInstanceSettings)
    .where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID))
  return row ?? null
}

/** The single instance settings row, locked until the transaction ends. */
export async function getInstanceSettingsForUpdate(
  db: DbOrTx,
): Promise<InstanceSettings | null> {
  const [row] = await db
    .select()
    .from(iamInstanceSettings)
    .where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID))
    .for('update')
  return row ?? null
}

/** Closes first-run setup for good. */
export async function markSetupCompleted(db: DbOrTx, at: Date): Promise<void> {
  await db
    .update(iamInstanceSettings)
    .set({ setupCompletedAt: at })
    .where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID))
}
