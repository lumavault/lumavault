import { createContextKey } from '@connectrpc/connect'
import { getConnInfo } from '@hono/node-server/conninfo'
import { UNKNOWN_CLIENT_IP } from '#/constants.js'
import type { Context } from 'hono'

// The raw HTTP request behind each RPC, so handlers and guards can read session headers.
export const requestKey = createContextKey<Request | undefined>(undefined, {
  description: 'http request',
})

// The caller's network address, for rate limits.
export const clientIpKey = createContextKey<string>(UNKNOWN_CLIENT_IP, {
  description: 'client ip',
})

/**
 * The caller's address. Behind a trusted proxy it is the last X-Forwarded-For entry, the one
 * the proxy added; earlier entries come from the client and can be forged.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const last = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()
    if (last) {
      return last
    }
  }
  try {
    return getConnInfo(c).remote.address ?? UNKNOWN_CLIENT_IP
  } catch {
    // Requests built in memory, as in tests, have no socket.
    return UNKNOWN_CLIENT_IP
  }
}
