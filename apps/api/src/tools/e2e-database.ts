// Recreates the database named in DATABASE_URL, empty, for the Portal end-to-end tests. The
// API migrates it when it starts. Refuses any database whose name does not start with lv_e2e.
import pg from "pg";

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

console.info(`e2e database ${name} is ready`);
