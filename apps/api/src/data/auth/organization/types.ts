import type { organization } from '#/db/schemas/auth.js'

/** A Better Auth organization row, which is a household's name and identity. */
export type Organization = typeof organization.$inferSelect
