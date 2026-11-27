// Drops, recreates, and pushes all schemas into the dedicated E2E database.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DB_SCHEMAS, DEFAULT_E2E_DATABASE_URL } from '#/db/constants.js'
import {
  createDatabase,
  ensureSchemas,
  loadSchemaModules,
} from '#/db/index.js'
import { pushSchema } from 'drizzle-kit/api'
import pg from 'pg'

const E2E_DB_NAME_PATTERN = /^[a-z0-9_]+_e2e$/

export interface E2eDatabaseTarget {
  dbName: string
  targetUrl: string
  adminUrl: string
}

export function parseE2eDatabaseUrl(
  rawUrl: string = DEFAULT_E2E_DATABASE_URL,
): E2eDatabaseTarget {
  const url = new URL(rawUrl)
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!E2E_DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `refusing to reset database "${dbName}": E2E database name must match ${E2E_DB_NAME_PATTERN}`,
    )
  }
  const adminUrl = new URL(url.toString())
  adminUrl.pathname = '/postgres'
  return {
    dbName,
    targetUrl: url.toString(),
    adminUrl: adminUrl.toString(),
  }
}

export async function resetE2eDatabase(rawUrl?: string): Promise<void> {
  const { dbName, targetUrl, adminUrl } = parseE2eDatabaseUrl(rawUrl)

  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`drop database if exists "${dbName}" with (force)`)
    await admin.query(`create database "${dbName}"`)
  } finally {
    await admin.end()
  }

  const database = createDatabase(targetUrl)
  try {
    await ensureSchemas(database.db)
    const push = await pushSchema(await loadSchemaModules(), database.db, [
      ...DB_SCHEMAS,
    ])
    await push.apply()
  } finally {
    await database.close()
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await resetE2eDatabase(process.env.E2E_DATABASE_URL)
}
