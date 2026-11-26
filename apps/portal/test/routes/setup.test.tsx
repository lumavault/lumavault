import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  CompleteSetupResponseSchema,
  GetSetupStatusResponseSchema,
  GetViewerResponseSchema,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPortal } from '#test/support/render-portal'
import { describe, expect, it } from 'vitest'

describe('Setup route (/setup)', () => {
  it('shows admin email hint, completes setup, and lands on / when session is active', async () => {
    let setupDone = false
    const { router } = renderPortal({
      initialPath: '/setup',
      unauthenticated: true,
      iamHandlers: {
        getSetupStatus: () =>
          create(GetSetupStatusResponseSchema, {
            needsSetup: !setupDone,
            adminEmailRequired: true,
          }),
        completeSetup: (req) => {
          setupDone = true
          return create(CompleteSetupResponseSchema, {
            user: {
              id: 'admin-1',
              name: req.name,
              email: req.email,
              isSuperAdmin: true,
            },
            household: {
              id: 'house-1',
              name: req.householdName,
              ownerUserId: 'admin-1',
            },
          })
        },
        getViewer: () => {
          if (!setupDone) {
            throw new ConnectError('sign in required', Code.Unauthenticated)
          }
          return create(GetViewerResponseSchema, {
            user: {
              id: 'admin-1',
              name: 'Vishrut',
              email: 'admin@example.com',
              isSuperAdmin: true,
            },
            household: {
              id: 'house-1',
              name: 'Agrawal Home',
              ownerUserId: 'admin-1',
            },
            role: Role.OWNER,
          })
        },
      },
    })

    expect(await screen.findByText('Admin email required')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Vishrut' },
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct-horse-battery' },
    })
    fireEvent.change(screen.getByLabelText('Household name'), {
      target: { value: 'Agrawal Home' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('sends the admin to /login with a notice if automatic sign-in failed after setup', async () => {
    let setupDone = false
    const { router } = renderPortal({
      initialPath: '/setup',
      unauthenticated: true,
      iamHandlers: {
        getSetupStatus: () =>
          create(GetSetupStatusResponseSchema, {
            needsSetup: !setupDone,
            adminEmailRequired: false,
          }),
        completeSetup: () => {
          setupDone = true
          return create(CompleteSetupResponseSchema, {})
        },
        getViewer: () => {
          throw new ConnectError('sign in required', Code.Unauthenticated)
        },
      },
    })

    expect(await screen.findByText('Set up LumaVault')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Owner' },
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'owner@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'strongpassword123' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'strongpassword123' },
    })
    fireEvent.change(screen.getByLabelText('Household name'), {
      target: { value: 'Home' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(await screen.findByText('Setup complete')).toBeInTheDocument()
  })

  it('redirects away from /setup once setup is already complete', async () => {
    const { router } = renderPortal({
      initialPath: '/setup',
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })
})
