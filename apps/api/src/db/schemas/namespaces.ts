import { pgSchema } from 'drizzle-orm/pg-core'

// One Drizzle schema object per Postgres schema. drizzle-kit drops any schema in its filter
// that the code does not declare, so every table file builds its tables from these.
export const authSchema = pgSchema('auth')
export const iamSchema = pgSchema('iam')
export const photosSchema = pgSchema('photos')
export const cinemaSchema = pgSchema('cinema')
export const arcadeSchema = pgSchema('arcade')
