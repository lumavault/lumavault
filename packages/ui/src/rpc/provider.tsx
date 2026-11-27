import * as React from 'react'
import { Code, ConnectError, type Transport } from '@connectrpc/connect'
import { TransportProvider } from '@connectrpc/connect-query'
import { createConnectTransport } from '@connectrpc/connect-web'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export const RPC_PREFIX = '/api/rpc'

const NON_RETRYABLE_CODES = new Set<Code>([
  Code.InvalidArgument,
  Code.NotFound,
  Code.AlreadyExists,
  Code.PermissionDenied,
  Code.FailedPrecondition,
  Code.Unauthenticated,
  Code.Unimplemented,
])

export interface CreateRpcTransportOptions {
  fetch?: typeof globalThis.fetch
}

export function createRpcTransport(
  apiUrl: string,
  options?: CreateRpcTransportOptions,
): Transport {
  const baseFetch = options?.fetch ?? globalThis.fetch
  const baseUrl = `${apiUrl.replace(/\/+$/, '')}${RPC_PREFIX}`

  return createConnectTransport({
    baseUrl,
    useHttpGet: true,
    fetch: (input, init) =>
      baseFetch(input, {
        ...init,
        credentials: 'include',
      }),
  })
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry(failureCount, error) {
          if (
            error instanceof ConnectError &&
            NON_RETRYABLE_CODES.has(error.code)
          ) {
            return false
          }
          return failureCount < 2
        },
      },
    },
  })
}

export interface RpcProviderProps {
  apiUrl: string
  transport?: Transport
  queryClient?: QueryClient
  children: React.ReactNode
}

export function RpcProvider({
  apiUrl,
  transport,
  queryClient,
  children,
}: RpcProviderProps) {
  const resolvedTransport = React.useMemo(
    () => transport ?? createRpcTransport(apiUrl),
    [apiUrl, transport],
  )
  const [defaultClient] = React.useState(
    () => queryClient ?? createQueryClient(),
  )
  const resolvedClient = queryClient ?? defaultClient

  return (
    <TransportProvider transport={resolvedTransport}>
      <QueryClientProvider client={resolvedClient}>
        {children}
      </QueryClientProvider>
    </TransportProvider>
  )
}
