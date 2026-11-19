import { pgSchema } from "drizzle-orm/pg-core";

// One Drizzle schema object per Postgres schema, which every table file builds its tables
// from. This file is not part of any schema's migration input, so generated migrations never
// create schemas; the migrator creates each one before applying its first migration.
export const authSchema = pgSchema("auth");
export const iamSchema = pgSchema("iam");
export const photosSchema = pgSchema("photos");
export const cinemaSchema = pgSchema("cinema");
export const arcadeSchema = pgSchema("arcade");
