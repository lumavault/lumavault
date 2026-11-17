// Read only by the Better Auth CLI to learn which plugins are on. Never imported at runtime.
// The pool never connects, because generating a Drizzle schema needs no database.
import { createDatabase } from "#/db/index.js";
import { createAuth } from "#/auth/auth.js";

const SCHEMA_ONLY_SECRET = "schema-generation-only-not-a-real-secret";

export const auth = createAuth({
  db: createDatabase("postgres://localhost/schema-generation").db,
  tables: {},
  secret: SCHEMA_ONLY_SECRET,
  baseURL: "http://localhost",
  trustedOrigins: ["http://localhost"],
  passkeyRpID: "localhost",
  sendMagicLink: async () => {},
  sendPasswordReset: async () => {},
});
