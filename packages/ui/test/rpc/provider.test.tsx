import { create } from '@bufbuild/protobuf'
import { createRouterTransport } from '@connectrpc/connect'
import { useQuery } from '@connectrpc/connect-query'
import {
  GetSetupStatusResponseSchema,
  IamService,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { render, screen, waitFor } from '@testing-library/react'
import { createRpcTransport, RpcProvider } from '#rpc'
import { describe, expect, it, vi } from 'vitest'

function SetupProbe() {
  const { data, isPending } = useQuery(IamService.method.getSetupStatus)
  if (isPending) return <div>loading</div>
  return <div>{data?.needsSetup ? 'needs-setup' : 'ready'}</div>
}

describe('RpcProvider and createRpcTransport', () => {
  it('sets credentials include on cross-origin requests to /api/rpc', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ needsSetup: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const transport = createRpcTransport('http://localhost:4000/', {
      fetch: fakeFetch,
    })

    render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <SetupProbe />
      </RpcProvider>,
    )

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0)
    })

    expect(calls[0]?.url).toContain('http://localhost:4000/api/rpc/')
    expect(calls[0]?.init?.credentials).toBe('include')
  })

  it('serves Connect-Query hooks through a custom transport', async () => {
    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getSetupStatus: () =>
          create(GetSetupStatusResponseSchema, { needsSetup: true }),
      })
    })

    render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <SetupProbe />
      </RpcProvider>,
    )

    expect(await screen.findByText('needs-setup')).toBeInTheDocument()
  })
})
