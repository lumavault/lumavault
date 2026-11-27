import { create } from '@bufbuild/protobuf'
import { Code, ConnectError, createRouterTransport } from '@connectrpc/connect'
import {
  GetViewerResponseSchema,
  IamService,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  AuthGuard,
  AuthProvider,
  useAuthClient,
  useRefreshViewer,
  useSignOut,
  type AuthClient,
} from '#auth'
import { createQueryClient, RpcProvider } from '#rpc'
import { describe, expect, it, vi } from 'vitest'

function makeFakeAuthClient(overrides?: Record<string, unknown>): AuthClient {
  return {
    signIn: {
      email: vi.fn(async () => ({ data: {} })),
      magicLink: vi.fn(async () => ({ data: {} })),
      passkey: vi.fn(async () => ({ data: {} })),
    },
    signUp: {
      email: vi.fn(async () => ({ data: {} })),
    },
    signOut: vi.fn(async () => ({ data: {} })),
    changePassword: vi.fn(async () => ({ data: {} })),
    listAccounts: vi.fn(async () => ({ data: [] })),
    passkey: {
      listUserPasskeys: vi.fn(async () => ({ data: [] })),
      addPasskey: vi.fn(async () => ({ data: { id: 'pk-1', name: 'Mac' } })),
      deletePasskey: vi.fn(async () => ({ data: {} })),
    },
    ...overrides,
  } as unknown as AuthClient
}

describe('AuthGuard', () => {
  it('redirects signed-out visitors to Portal /login with validated returnTo', async () => {
    const onRedirect = vi.fn()
    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getViewer: () => {
          throw new ConnectError('sign in required', Code.Unauthenticated)
        },
      })
    })

    render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <AuthProvider
          apiUrl="http://localhost:4000"
          portalUrl="http://localhost:3000"
          allowedOrigins={['http://localhost:3001']}
          authClient={makeFakeAuthClient()}
        >
          <AuthGuard
            currentUrl="http://localhost:3001/albums"
            onRedirect={onRedirect}
          >
            <div>secret</div>
          </AuthGuard>
        </AuthProvider>
      </RpcProvider>,
    )

    await waitFor(() => {
      expect(onRedirect).toHaveBeenCalledWith(
        'http://localhost:3000/login?returnTo=http%3A%2F%2Flocalhost%3A3001%2Falbums',
      )
    })
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('redirects zero-household users unless allowNoHousehold is true', async () => {
    const onRedirect = vi.fn()
    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: { id: 'u1', name: 'Guest', email: 'g@example.com' },
          }),
      })
    })

    const { rerender } = render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <AuthProvider
          apiUrl="http://localhost:4000"
          portalUrl="http://localhost:3000"
          authClient={makeFakeAuthClient()}
        >
          <AuthGuard onRedirect={onRedirect}>
            <div>household-only</div>
          </AuthGuard>
        </AuthProvider>
      </RpcProvider>,
    )

    await waitFor(() => {
      expect(onRedirect).toHaveBeenCalledWith('http://localhost:3000/')
    })

    rerender(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <AuthProvider
          apiUrl="http://localhost:4000"
          portalUrl="http://localhost:3000"
          authClient={makeFakeAuthClient()}
        >
          <AuthGuard allowNoHousehold onRedirect={onRedirect}>
            <div>allowed-without-household</div>
          </AuthGuard>
        </AuthProvider>
      </RpcProvider>,
    )

    expect(
      await screen.findByText('allowed-without-household'),
    ).toBeInTheDocument()
  })

  it('enforces requireSuperAdmin with forbidden fallback', async () => {
    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: {
              id: 'u2',
              name: 'Member',
              email: 'm@example.com',
              isSuperAdmin: false,
            },
            household: { id: 'h1', name: 'Home', ownerUserId: 'u1' },
            role: Role.MEMBER,
          }),
      })
    })

    render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <AuthProvider
          apiUrl="http://localhost:4000"
          portalUrl="http://localhost:3000"
          authClient={makeFakeAuthClient()}
        >
          <AuthGuard
            requireSuperAdmin
            forbiddenFallback={<div>admin-only</div>}
          >
            <div>console</div>
          </AuthGuard>
        </AuthProvider>
      </RpcProvider>,
    )

    expect(await screen.findByText('admin-only')).toBeInTheDocument()
    expect(screen.queryByText('console')).not.toBeInTheDocument()
  })

  it('shows a retryable error instead of redirecting on server errors', async () => {
    const onRedirect = vi.fn()
    let fail = true
    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getViewer: () => {
          if (fail) {
            throw new ConnectError('api restarting', Code.Unavailable)
          }
          return create(GetViewerResponseSchema, {
            user: { id: 'u1', name: 'Alice', email: 'a@example.com' },
            household: { id: 'h1', name: 'Home', ownerUserId: 'u1' },
            role: Role.OWNER,
          })
        },
      })
    })

    render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <AuthProvider
          apiUrl="http://localhost:4000"
          portalUrl="http://localhost:3000"
          authClient={makeFakeAuthClient()}
        >
          <AuthGuard onRedirect={onRedirect}>
            <div>protected-content</div>
          </AuthGuard>
        </AuthProvider>
      </RpcProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('api restarting')
    expect(onRedirect).not.toHaveBeenCalled()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('protected-content')).toBeInTheDocument()
  })
})

describe('useAuthClient, useRefreshViewer, and useSignOut', () => {
  it('exposes the Better Auth client, refreshes viewer, and cancels/clears cache on sign-out', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(['sample'], 'cached-value')
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries')
    const clearSpy = vi.spyOn(queryClient, 'clear')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const signInEmail = vi.fn(async () => ({ data: {} }))
    const authClient = makeFakeAuthClient({
      signIn: { email: signInEmail },
    })

    function Probe() {
      const client = useAuthClient()
      const refreshViewer = useRefreshViewer()
      const { signOut } = useSignOut()
      return (
        <div>
          <button
            type="button"
            onClick={async () => {
              await client.signIn.email({ email: 'a@b.com', password: 'pw' })
              await refreshViewer()
            }}
          >
            in
          </button>
          <button type="button" onClick={() => void signOut()}>
            out
          </button>
        </div>
      )
    }

    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getViewer: () => {
          throw new ConnectError('sign in required', Code.Unauthenticated)
        },
      })
    })

    render(
      <RpcProvider
        apiUrl="http://localhost:4000"
        transport={transport}
        queryClient={queryClient}
      >
        <AuthProvider
          apiUrl="http://localhost:4000"
          portalUrl="http://localhost:3000"
          authClient={authClient}
        >
          <Probe />
        </AuthProvider>
      </RpcProvider>,
    )

    fireEvent.click(screen.getByText('in'))
    await waitFor(() => {
      expect(signInEmail).toHaveBeenCalled()
      expect(invalidateSpy).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByText('out'))
    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalled()
      expect(clearSpy).toHaveBeenCalled()
    })
    expect(queryClient.getQueryData(['sample'])).toBeUndefined()
  })
})
