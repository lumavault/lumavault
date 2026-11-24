import { defineConfig } from 'drizzle-kit'

import { parseSchemaFilter } from './src/db/index.js'

// Set DB_SCHEMA to push only some schemas, for example DB_SCHEMA=photos pnpm db:push.
// Schemas left out of the filter are never touched.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schemas/**/*.ts',
  schemaFilter: parseSchemaFilter(process.env.DB_SCHEMA),
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
})
