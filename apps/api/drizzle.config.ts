import { defineConfig } from "drizzle-kit";
import { parseSchemaName } from "./src/db/index.js";

// Generates migrations for one schema at a time, from that schema's table files only, for
// example DB_SCHEMA=iam pnpm db:generate. Tables from other schemas that these files refer to
// are not exported from them, so they never appear in this schema's migrations.
const schema = parseSchemaName(process.env.DB_SCHEMA);

export default defineConfig({
  dialect: "postgresql",
  schema: [`./src/db/schemas/${schema}.ts`, `./src/db/schemas/${schema}/**/*.ts`],
  out: `./migrations/${schema}`,
  strict: true,
});
