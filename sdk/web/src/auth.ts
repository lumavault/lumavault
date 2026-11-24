import { AUTHORIZATION_HEADER, SERVICE_KEY_HEADER } from './constants.js'

/** What a call presents to the gateway: a per-call ticket, or the client-wide service key. */
export interface Credentials {
  ticket?: string
  serviceKey?: string
}

/** Headers for one call. A ticket wins over the service key, since it is the narrower grant. */
export function authHeaders({
  ticket,
  serviceKey,
}: Credentials): Record<string, string> {
  if (ticket) {
    return { [AUTHORIZATION_HEADER]: `Bearer ${ticket}` }
  }
  if (serviceKey) {
    return { [SERVICE_KEY_HEADER]: serviceKey }
  }
  return {}
}
