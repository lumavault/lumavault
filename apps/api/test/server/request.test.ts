import { UNKNOWN_CLIENT_IP } from '#/constants.js'
import { clientIp } from '#/server/request.js'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

async function ipFor(
  headers: Record<string, string>,
  trustProxy: boolean,
): Promise<string> {
  const app = new Hono()
  app.get('/', (c) => c.text(clientIp(c, trustProxy)))
  return (await app.request('/', { headers })).text()
}

describe('clientIp', () => {
  it('takes the last X-Forwarded-For entry, the one the proxy added, when the proxy is trusted', async () => {
    expect(await ipFor({ 'x-forwarded-for': '6.6.6.6, 10.0.0.7' }, true)).toBe(
      '10.0.0.7',
    )
  })

  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    expect(await ipFor({ 'x-forwarded-for': '10.0.0.7' }, false)).toBe(
      UNKNOWN_CLIENT_IP,
    )
  })
})
