// An IamService client that calls the Hono app in memory. Tests only.
import { createClient, type Client } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { RPC_PREFIX } from '#/routes.js'
import type { Hono } from 'hono'

export function iamClient(
  app: Hono,
  headers?: Headers,
  options: { useHttpGet?: boolean } = {},
): Client<typeof IamService> {
  return createClient(
    IamService,
    createConnectTransport({
      baseUrl: `http://api.test${RPC_PREFIX}`,
      useHttpGet: options.useHttpGet ?? false,
      fetch: async (input, init) => app.request(new Request(input, init)),
      interceptors: [
        (next) => (req) => {
          headers?.forEach((value, key) => req.header.set(key, value))
          return next(req)
        },
      ],
    }),
  )
}
