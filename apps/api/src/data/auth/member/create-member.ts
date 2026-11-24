import { randomUUID } from 'node:crypto'
import type { DbOrTx } from '#/db/index.js'
import { member } from '#/db/schemas/auth.js'

export interface NewMember {
  organizationId: string
  userId: string
  role: string
  createdAt: Date
}

export async function createMember(
  db: DbOrTx,
  input: NewMember,
): Promise<void> {
  await db.insert(member).values({ id: randomUUID(), ...input })
}
