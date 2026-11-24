import { randomUUID } from 'node:crypto'
import { HOUSEHOLD_SLUG_PREFIX } from '#/auth/constants.js'
import type { DbOrTx } from '#/db/index.js'
import { organization } from '#/db/schemas/auth.js'

import type { Organization } from './types.js'

/** Inserts the organization behind a new household. Slugs are never shown, so they are random. */
export async function createOrganization(
  db: DbOrTx,
  input: { name: string; createdAt: Date },
): Promise<Organization> {
  const [row] = await db
    .insert(organization)
    .values({
      id: randomUUID(),
      name: input.name,
      slug: `${HOUSEHOLD_SLUG_PREFIX}${randomUUID()}`,
      createdAt: input.createdAt,
    })
    .returning()
  return row!
}
