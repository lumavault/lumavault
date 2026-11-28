import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  App,
  GetSetupStatusResponseSchema,
  GetViewerResponseSchema,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPortal } from '#test/support/render-portal'
import { describe, expect, it } from 'vitest'

describe('Portal shell and Home route', () => {
  it('renders only enabled apps, storage usage, and hides Server Admin nav for regular users', async () => {
    renderPortal({ initialPath: '/' })

    expect(
      await screen.findByRole('heading', { name: 'Agrawal Home' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Photos')).toBeInTheDocument()
    expect(screen.getByText('Cinema')).toBeInTheDocument()
    expect(screen.queryByText('Arcade')).not.toBeInTheDocument()
    expect(screen.getByText(/25 GB used/)).toBeInTheDocument()
    expect(screen.getByText(/5 GB reserved/)).toBeInTheDocument()
    expect(screen.queryByText('Server Admin')).not.toBeInTheDocument()
  })

  it('shows Server Admin navigation for Super-Admins', async () => {
    renderPortal({
      initialPath: '/',
      iamHandlers: {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: {
              id: 'admin-1',
              name: 'Admin',
              email: 'admin@example.com',
              isSuperAdmin: true,
            },
            household: {
              id: 'h-1',
              name: 'Main House',
              ownerUserId: 'admin-1',
              allowance: {
                storageCapBytes: (1n << 63n) - 1n,
                enabledApps: [App.PHOTOS, App.CINEMA, App.ARCADE],
                memberLimit: 4,
              },
            },
            role: Role.OWNER,
            usage: {
              usedBytes: 0n,
              reservedBytes: 0n,
              remainingBytes: (1n << 63n) - 1n,
            },
          }),
      },
    })

    expect(await screen.findByText('Server Admin')).toBeInTheDocument()
    expect(screen.getByText('Unlimited')).toBeInTheDocument()
    expect(screen.getByText('Arcade')).toBeInTheDocument()
  })

  it('renders an empty state when the signed-in user belongs to no household', async () => {
    renderPortal({
      initialPath: '/',
      iamHandlers: {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: {
              id: 'u-2',
              name: 'Sam',
              email: 'sam@example.com',
              isSuperAdmin: false,
            },
          }),
      },
    })

    expect(await screen.findByText('No household yet')).toBeInTheDocument()
  })

  it('redirects to /setup when GetSetupStatus reports needsSetup is true', async () => {
    const { router } = renderPortal({
      initialPath: '/',
      unauthenticated: true,
      iamHandlers: {
        getSetupStatus: () =>
          create(GetSetupStatusResponseSchema, {
            needsSetup: true,
            adminEmailRequired: false,
          }),
      },
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/setup')
    })
  })

  it('redirects signed-out visitors to /login with returnTo', async () => {
    const { router } = renderPortal({
      initialPath: '/',
      unauthenticated: true,
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('shows a retryable error when GetSetupStatus fails', async () => {
    let fail = true
    renderPortal({
      initialPath: '/',
      iamHandlers: {
        getSetupStatus: () => {
          if (fail) {
            throw new ConnectError('server offline', Code.Unavailable)
          }
          return create(GetSetupStatusResponseSchema, {
            needsSetup: false,
            adminEmailRequired: false,
          })
        },
      },
    })

    expect(await screen.findByText('server offline')).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('heading', { name: 'Agrawal Home' }),
    ).toBeInTheDocument()
  })
})
