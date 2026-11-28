import { randomUUID } from 'node:crypto'
import { DB_SCHEMAS, DEFAULT_TEST_DATABASE_URL } from '#/db/constants.js'
import { createDatabase } from '#/db/index.js'
import {
  parseE2eDatabaseUrl,
  resetE2eDatabase,
} from '#/tools/reset-e2e-db.js'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { describe, expect, it } from 'vitest'

describe('parseE2eDatabaseUrl', () => {
  it('defaults to lumavault_e2e and connects to postgres as admin db', () => {
    const parsed = parseE2eDatabaseUrl()
    expect(parsed.dbName).toBe('lumavault_e2e')
    expect(parsed.targetUrl).toBe(
      'postgres://lumavault:lumavault@localhost:5432/lumavault_e2e',
    )
    expect(parsed.adminUrl).toBe(
      'postgres://lumavault:lumavault@localhost:5432/postgres',
    )
  })

  it('refuses to reset non-e2e or unsafe database names', () => {
    expect(() =>
      parseE2eDatabaseUrl(
        'postgres://lumavault:lumavault@localhost:5432/lumavault',
      ),
    ).toThrow(/refusing to reset/)
    expect(() =>
      parseE2eDatabaseUrl(
        'postgres://lumavault:lumavault@localhost:5432/bad-name_e2e',
      ),
    ).toThrow(/refusing to reset/)
  })
})

describe('resetE2eDatabase', () => {
  it('recreates the database cleanly and pushes all schemas', async () => {
    const serverUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL
    const dbName = `lv_test_${randomUUID().replaceAll('-', '').slice(0, 12)}_e2e`
    const target = new URL(serverUrl)
    target.pathname = `/${dbName}`
    const adminUrl = new URL(serverUrl)
    adminUrl.pathname = '/postgres'

    try {
      await resetE2eDatabase(target.toString())

      const first = createDatabase(target.toString())
      try {
        await first.db.execute(
          sql`create table public.stale_marker (id int primary key)`,
        )
      } finally {
        await first.close()
      }

      await resetE2eDatabase(target.toString())

      const second = createDatabase(target.toString())
      try {
        const marker = await second.db.execute<{ t: string | null }>(
          sql`select to_regclass('public.stale_marker') as t`,
        )
        expect(marker.rows[0]).toEqual({ t: null })

        const schemas = await second.db.execute<{ nspname: string }>(
          sql`select nspname from pg_namespace`,
        )
        expect(schemas.rows.map((r) => r.nspname)).toEqual(
          expect.arrayContaining([...DB_SCHEMAS]),
        )
      } finally {
        await second.close()
      }
    } finally {
      const admin = new pg.Client({ connectionString: adminUrl.toString() })
      await admin.connect()
      try {
        await admin.query(`drop database if exists "${dbName}" with (force)`)
      } finally {
        await admin.end()
      }
    }
  }, 60_000)
})
