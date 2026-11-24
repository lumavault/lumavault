import type { DbOrTx } from '#/db/index.js'
import { iamHouseholds } from '#/db/schemas/iam.js'

import type { Household, NewHousehold } from './types.js'

/** Inserts the allowance and usage row for a household that already has its organization. */
export async function createHousehold(
  db: DbOrTx,
  input: NewHousehold,
): Promise<Household> {
  const [row] = await db.insert(iamHouseholds).values(input).returning()
  return row!
}
