// Recreates the database named in DATABASE_URL and pushes every schema into it, for the
// Portal end-to-end tests. Refuses any database whose name does not start with lv_e2e.
import pg from "pg";
import { createDatabase } from "#/db/index.js";
import { pushAllSchemas } from "#/db/testing.js";

const url = new URL(process.env.DATABASE_URL ?? "");
const name = url.pathname.slice(1);
if (!name.startsWith("lv_e2e")) {
  console.error(`refusing to reset ${name || "(no database)"}; e2e databases start with lv_e2e`);
  process.exit(1);
}
const server = new URL(url);
server.pathname = "/postgres";
const admin = new pg.Client({ connectionString: server.toString() });
await admin.connect();
await admin.query(`drop database if exists "${name}" with (force)`);
await admin.query(`create database "${name}"`);
await admin.end();

const database = createDatabase(url.toString());
await pushAllSchemas(database);
await database.close();
console.info(`e2e database ${name} is ready`);
