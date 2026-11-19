// Command-line entry for pnpm db:migrate: applies every pending migration to DATABASE_URL.
// The API also does this when it starts, so this is for checking migrations without serving.
import { createDatabase } from "#/db/index.js";
import { migrateAll } from "#/db/migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const database = createDatabase(url);
try {
  await migrateAll(database.pool);
  console.info("migrations are up to date");
} finally {
  await database.close();
}
