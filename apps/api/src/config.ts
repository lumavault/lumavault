import { z } from 'zod'

import { DEFAULT_PORT, MIN_SECRET_BYTES } from './constants.js'
import { DEFAULT_MAIL_FROM } from './email/constants.js'

const secret = (isTest: boolean) =>
  z
    .string()
    .min(1)
    .refine((s) => isTest || Buffer.byteLength(s) >= MIN_SECRET_BYTES, {
      message: `must be at least ${MIN_SECRET_BYTES} bytes`,
    })

const originList = z
  .string()
  .min(1)
  .transform((s) =>
    s
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url().transform((u) => new URL(u).origin)).min(1))

const optional = z
  .string()
  .optional()
  .transform((s) => (s?.trim() ? s.trim() : undefined))

function schema(isTest: boolean) {
  return z.object({
    PORT: z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT),
    DATABASE_URL: z.url(),
    LUMAVAULT_GATEWAY_URL: z.url(),
    LUMAVAULT_TICKET_SECRET: secret(isTest),
    LUMAVAULT_SERVICE_KEY: secret(isTest),
    BETTER_AUTH_SECRET: secret(isTest),
    LUMAVAULT_API_URL: z.url().optional(),
    LUMAVAULT_WEB_ORIGINS: originList,
    LUMAVAULT_PORTAL_URL: z.url(),
    LUMAVAULT_ADMIN_EMAIL: z.email().optional(),
    LUMAVAULT_COOKIE_DOMAIN: optional,
    SMTP_URL: optional,
    LUMAVAULT_MAIL_FROM: optional,
    LUMAVAULT_TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  })
}

export interface Config {
  port: number
  databaseUrl: string
  gatewayUrl: string
  ticketSecret: string
  serviceKey: string
  authSecret: string
  /** Public origin of this server, used for Better Auth callbacks. */
  apiUrl: string
  /** Web app origins allowed to call the API with cookies. */
  webOrigins: string[]
  portalUrl: string
  adminEmail?: string
  cookieDomain?: string
  smtpUrl?: string
  /** Sender for every email, for example "LumaVault <no-reply@example.com>". */
  mailFrom: string
  /** Read the client address from the last X-Forwarded-For entry, which a reverse proxy adds. */
  trustProxy: boolean
}

/** Reads and checks config from the environment. Throws one error listing every problem. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const isTest = env.NODE_ENV === 'test'
  const parsed = schema(isTest).safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    )
    throw new Error(`invalid config:\n  ${problems.join('\n  ')}`)
  }
  const e = parsed.data
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    gatewayUrl: e.LUMAVAULT_GATEWAY_URL,
    ticketSecret: e.LUMAVAULT_TICKET_SECRET,
    serviceKey: e.LUMAVAULT_SERVICE_KEY,
    authSecret: e.BETTER_AUTH_SECRET,
    apiUrl: new URL(e.LUMAVAULT_API_URL ?? `http://localhost:${e.PORT}`).origin,
    webOrigins: e.LUMAVAULT_WEB_ORIGINS,
    portalUrl: e.LUMAVAULT_PORTAL_URL,
    adminEmail: e.LUMAVAULT_ADMIN_EMAIL?.toLowerCase(),
    cookieDomain: e.LUMAVAULT_COOKIE_DOMAIN,
    smtpUrl: e.SMTP_URL,
    mailFrom: e.LUMAVAULT_MAIL_FROM ?? DEFAULT_MAIL_FROM,
    trustProxy: e.LUMAVAULT_TRUST_PROXY === 'true',
  }
}
