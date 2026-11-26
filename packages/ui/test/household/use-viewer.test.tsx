import { create } from '@bufbuild/protobuf'
import { Code, ConnectError, createRouterTransport } from '@connectrpc/connect'
import {
  App,
  GetViewerResponseSchema,
  IamService,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { render, screen } from '@testing-library/react'
import { appLabel, hasEnabledApp, roleLabel, useViewer } from '#household'
import { RpcProvider } from '#rpc'
import { describe, expect, it } from 'vitest'

function ViewerProbe() {
  const viewer = useViewer()
  if (viewer.isPending) return <div>loading</div>
  if (viewer.error) return <div>error:{viewer.error.message}</div>
  if (!viewer.isAuthenticated) return <div>signed-out</div>
  return (
    <div>
      <span data-testid="user">{viewer.user?.name}</span>
      <span data-testid="household">{viewer.household?.name ?? 'none'}</span>
      <span data-testid="role">{roleLabel(viewer.role)}</span>
      <span data-testid="super">{String(viewer.isSuperAdmin)}</span>
      <span data-testid="admin">{String(viewer.isHouseholdAdmin)}</span>
      <span data-testid="photos">
        {String(hasEnabledApp(viewer.enabledApps, App.PHOTOS))}
      </span>
    </div>
  )
}

describe('useViewer', () => {
  it('returns user, household, role, and enabled apps when signed in', async () => {
    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: {
              id: 'u1',
              name: 'Alice',
              email: 'alice@example.com',
              isSuperAdmin: true,
            },
            household: {
              id: 'h1',
              name: 'Agrawal Home',
              ownerUserId: 'u1',
              allowance: {
                storageCapBytes: 100n * 1024n ** 3n,
                enabledApps: [App.PHOTOS, App.CINEMA],
                memberLimit: 4,
              },
            },
            role: Role.OWNER,
            usage: {
              usedBytes: 10n * 1024n ** 3n,
              reservedBytes: 0n,
              remainingBytes: 90n * 1024n ** 3n,
            },
          }),
      })
    })

    render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <ViewerProbe />
      </RpcProvider>,
    )

    expect(await screen.findByTestId('user')).toHaveTextContent('Alice')
    expect(screen.getByTestId('household')).toHaveTextContent('Agrawal Home')
    expect(screen.getByTestId('role')).toHaveTextContent('Owner')
    expect(screen.getByTestId('super')).toHaveTextContent('true')
    expect(screen.getByTestId('admin')).toHaveTextContent('true')
    expect(screen.getByTestId('photos')).toHaveTextContent('true')
    expect(appLabel(App.ARCADE)).toBe('Arcade')
  })

  it('handles a signed-in user with no household', async () => {
    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: {
              id: 'u2',
              name: 'Bob',
              email: 'bob@example.com',
              isSuperAdmin: false,
            },
          }),
      })
    })

    render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <ViewerProbe />
      </RpcProvider>,
    )

    expect(await screen.findByTestId('user')).toHaveTextContent('Bob')
    expect(screen.getByTestId('household')).toHaveTextContent('none')
    expect(screen.getByTestId('admin')).toHaveTextContent('false')
  })

  it('treats Unauthenticated as signed-out without surfacing an error', async () => {
    const transport = createRouterTransport(({ service }) => {
      service(IamService, {
        getViewer: () => {
          throw new ConnectError('sign in required', Code.Unauthenticated)
        },
      })
    })

    render(
      <RpcProvider apiUrl="http://localhost:4000" transport={transport}>
        <ViewerProbe />
      </RpcProvider>,
    )

    expect(await screen.findByText('signed-out')).toBeInTheDocument()
  })
})
