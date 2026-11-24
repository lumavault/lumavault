import { createApp } from '#/server/app.js'
import { requestContext } from '#/server/context.js'
import type { ModuleContext } from '#/server/modules.js'
import {
  createTestContext,
  recordingEmail,
  rpcValues,
  signUp,
  TEST_APP_ORIGINS,
} from '#test/support/context.js'
import {
  createTestDatabase,
  pushAllSchemas,
  type TestDatabase,
} from '#test/support/db.js'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const [PORTAL, PHOTOS, CINEMA, ARCADE] = TEST_APP_ORIGINS as [
  string,
  string,
  string,
  string,
]
const PASSWORD = 'correct horse battery'

let database: TestDatabase
let ctx: ModuleContext
let app: Hono
const email = recordingEmail()

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: PORTAL, ...headers },
    body: JSON.stringify(body),
  })
}

// Better Auth sets the session as a signed cookie; keep only the name=value pairs.
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function sessionEmail(
  headers: Record<string, string>,
): Promise<string | undefined> {
  const res = await app.request('/api/auth/get-session', { headers })
  const body = (await res.json()) as { user?: { email?: string } } | null
  return body?.user?.email
}

beforeAll(async () => {
  database = await createTestDatabase()
  await pushAllSchemas(database)
  ctx = createTestContext(database, { email })
  app = createApp(ctx, [])
  await signUp(ctx, 'ada@example.com')
})

afterAll(async () => {
  await database?.drop()
})

describe('password sign-in', () => {
  it('sets a session cookie that every web app can use', async () => {
    const res = await post('/api/auth/sign-in/email', {
      email: 'ada@example.com',
      password: PASSWORD,
    })
    expect(res.status).toBe(200)
    const cookie = cookieFrom(res)
    expect(cookie).toMatch(/session_token=/)
    for (const origin of [PORTAL, PHOTOS, CINEMA, ARCADE]) {
      expect(await sessionEmail({ cookie, origin }), origin).toBe(
        'ada@example.com',
      )
    }
  })

  it('rejects a wrong password', async () => {
    const res = await post('/api/auth/sign-in/email', {
      email: 'ada@example.com',
      password: 'nope nope nope',
    })
    expect(res.status).toBe(401)
  })
})

describe('bearer tokens', () => {
  it('returns a token Apple apps can send instead of a cookie', async () => {
    const res = await post('/api/auth/sign-in/email', {
      email: 'ada@example.com',
      password: PASSWORD,
    })
    const token = res.headers.get('set-auth-token')
    expect(token).toBeTruthy()
    expect(await sessionEmail({ authorization: `Bearer ${token}` })).toBe(
      'ada@example.com',
    )
    const { viewer } = await requestContext(
      rpcValues(new Headers({ authorization: `Bearer ${token}` })),
      ctx,
    )
    expect(viewer?.email).toBe('ada@example.com')
  })
})

describe('magic links', () => {
  it('emails a link through the mailer that signs the user in', async () => {
    email.sent.length = 0
    const res = await post('/api/auth/sign-in/magic-link', {
      email: 'ada@example.com',
      callbackURL: `${PORTAL}/`,
    })
    expect(res.status).toBe(200)
    expect(email.sent).toEqual([
      expect.objectContaining({ kind: 'magic-link', to: 'ada@example.com' }),
    ])

    const link = new URL(email.sent[0]!.url)
    const verify = await app.request(link.pathname + link.search, {
      headers: { origin: PORTAL },
    })
    expect(verify.status).toBe(302)
    expect(await sessionEmail({ cookie: cookieFrom(verify) })).toBe(
      'ada@example.com',
    )
  })
})

describe('passkeys', () => {
  it('serves sign-in options with a fresh challenge', async () => {
    const res = await app.request(
      '/api/auth/passkey/generate-authenticate-options',
      { headers: { origin: PORTAL } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { challenge?: string; rpId?: string }
    expect(body.challenge).toBeTruthy()
    expect(body.rpId).toBe('localhost')
  })
})
