import type { DbOrTx } from '#/db/index.js'
import { iamInstanceSettings } from '#/db/schemas/iam.js'
import { INSTANCE_SETTINGS_ID } from '#/iam/constants.js'
import { eq } from 'drizzle-orm'

/** Closes first-run setup for good. */
export async function markSetupCompleted(db: DbOrTx, at: Date): Promise<void> {
  await db
    .update(iamInstanceSettings)
    .set({ setupCompletedAt: at })
    .where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID))
}
