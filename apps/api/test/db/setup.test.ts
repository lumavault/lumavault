import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DB_SCHEMAS } from '#/db/constants.js'
import {
  ensureSchemas,
  loadSchemaModules,
  parseSchemaFilter,
} from '#/db/index.js'
import * as namespaces from '#/db/schemas/namespaces.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const API_DIR = fileURLToPath(new URL('../../', import.meta.url))

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database?.drop()
})

async function schemaNames(): Promise<string[]> {
  const res = await database.db.execute<{ nspname: string }>(
    sql`select nspname from pg_namespace`,
  )
  return res.rows.map((r) => r.nspname)
}

async function tableNames(schema: string): Promise<string[]> {
  const res = await database.db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = ${schema} order by table_name`,
  )
  return res.rows.map((r) => r.table_name)
}

describe('ensureSchemas', () => {
  it('creates every schema and is safe to run again', async () => {
    await ensureSchemas(database.db)
    await ensureSchemas(database.db)
    expect(await schemaNames()).toEqual(expect.arrayContaining([...DB_SCHEMAS]))
  })

  it('is safe to run in parallel on a fresh database', async () => {
    const fresh = await createTestDatabase()
    try {
      await Promise.all(
        Array.from({ length: 5 }, () => ensureSchemas(fresh.db)),
      )
    } finally {
      await fresh.drop()
    }
  })
})

describe('db:push with DB_SCHEMA', () => {
  it('changes only the named schema', async () => {
    await ensureSchemas(database.db)
    await database.db.execute(
      sql`create table cinema.keep_me (id text primary key)`,
    )
    await database.db.execute(sql`insert into cinema.keep_me values ('row')`)
    // Not declared in code, so a push that reaches photos drops it.
    await database.db.execute(
      sql`create table photos.stray (id text primary key)`,
    )

    await execFileAsync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: database.url, DB_SCHEMA: 'photos' },
    })

    expect(await tableNames('photos')).toEqual([])
    expect(await tableNames('cinema')).toEqual(['keep_me'])
    const kept = await database.db.execute(
      sql`select count(*)::int as n from cinema.keep_me`,
    )
    expect(kept.rows[0]).toEqual({ n: 1 })
  }, 60_000)
})

describe('test databases', () => {
  it('can be filled with every declared schema', async () => {
    const fresh = await createTestDatabase()
    try {
      await pushAllSchemas(fresh)
      const res = await fresh.db.execute<{ nspname: string }>(
        sql`select nspname from pg_namespace`,
      )
      expect(res.rows.map((r) => r.nspname)).toEqual(
        expect.arrayContaining([...DB_SCHEMAS]),
      )
    } finally {
      await fresh.drop()
    }
  })

  it('do not share data', async () => {
    const a = await createTestDatabase()
    const b = await createTestDatabase()
    try {
      await a.db.execute(sql`create table shared_name (id int)`)
      await a.db.execute(sql`insert into shared_name values (1)`)
      const res = await b.db.execute(
        sql`select to_regclass('public.shared_name') as t`,
      )
      expect(res.rows[0]).toEqual({ t: null })
    } finally {
      await Promise.all([a.drop(), b.drop()])
    }
  })
})

describe('parseSchemaFilter', () => {
  it('defaults to every schema', () => {
    expect(parseSchemaFilter(undefined)).toEqual([...DB_SCHEMAS])
    expect(parseSchemaFilter('')).toEqual([...DB_SCHEMAS])
  })

  it('accepts a list and rejects unknown names', () => {
    expect(parseSchemaFilter('photos, iam')).toEqual(['photos', 'iam'])
    expect(() => parseSchemaFilter('public')).toThrow(/unknown schema public/)
  })
})

describe('loadSchemaModules', () => {
  let dir: string

  it('loads the real schema folder, including the shared namespaces', async () => {
    expect(await loadSchemaModules()).toMatchObject({
      photosSchema: namespaces.photosSchema,
    })
  })

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lv-schemas-'))
    await mkdir(join(dir, 'iam'))
    await writeFile(join(dir, 'top.js'), 'export const top = 1;\n')
    await writeFile(join(dir, 'iam', 'nested.js'), 'export const nested = 2;\n')
    await writeFile(
      join(dir, 'iam', 'skip.test.js'),
      'export const skipped = 3;\n',
    )
    await writeFile(
      join(dir, 'types.d.ts'),
      'export declare const typesOnly: 4;\n',
    )
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads files in subfolders and skips tests and declarations', async () => {
    expect(await loadSchemaModules(dir)).toEqual({ top: 1, nested: 2 })
  })

  it('rejects the same export name in two files', async () => {
    await writeFile(join(dir, 'iam', 'dupe.js'), 'export const top = 5;\n')
    await expect(loadSchemaModules(dir)).rejects.toThrow(/top is defined twice/)
    await rm(join(dir, 'iam', 'dupe.js'))
  })

  it('returns nothing when the folder does not exist', async () => {
    expect(await loadSchemaModules(join(dir, 'missing'))).toEqual({})
  })
})
