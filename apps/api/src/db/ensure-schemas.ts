// Command-line entry: creates the LumaVault schemas before drizzle-kit pushes tables into them.
import { createDatabase, ensureSchemas } from './index.js'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}
const database = createDatabase(url)
try {
  await ensureSchemas(database.db)
} finally {
  await database.close()
}
