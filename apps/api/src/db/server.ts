import pg from "pg";

/** Runs fn with one connection to the Postgres server at url, then closes it. */
export async function withServer<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The URL of another database on the same server as url. */
export function databaseUrl(url: string, name: string): string {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}
