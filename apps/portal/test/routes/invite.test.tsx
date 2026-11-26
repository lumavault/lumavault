import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  GetInviteResponseSchema,
  GetViewerResponseSchema,
  InviteKind,
  JoinHouseholdResponseSchema,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createFakeAuthClient, renderPortal } from '#test/support/render-portal'
import { describe, expect, it, vi } from 'vitest'

const FUTURE = timestampFromDate(new Date(Date.now() + 86_400_000))

describe('Invite redemption routes', () => {
  it('lets a new user sign up and create a household from a household invite', async () => {
    let signedIn = false
    let joinedHouseholdName = ''
    const authClient = createFakeAuthClient({
      signUp: {
        email: vi.fn(async () => {
          signedIn = true
          return { data: {} }
        }),
      },
    })

    const { router } = renderPortal({
      initialPath: '/invite/household/secret-token',
      unauthenticated: true,
      authClient,
      iamHandlers: {
        getInvite: () =>
          create(GetInviteResponseSchema, {
            kind: InviteKind.NEW_HOUSEHOLD,
            email: 'newowner@example.com',
            inviterName: 'Vishrut',
            role: Role.OWNER,
            expiresAt: FUTURE,
          }),
        getViewer: () => {
          if (!signedIn) {
            throw new ConnectError('sign in required', Code.Unauthenticated)
          }
          return create(GetViewerResponseSchema, {
            user: {
              id: 'u-new',
              name: 'Maya',
              email: 'newowner@example.com',
            },
            household: joinedHouseholdName
              ? {
                  id: 'h-new',
                  name: joinedHouseholdName,
                  ownerUserId: 'u-new',
                }
              : undefined,
            role: joinedHouseholdName ? Role.OWNER : Role.UNSPECIFIED,
          })
        },
        joinHousehold: (req) => {
          joinedHouseholdName = req.householdName
          return create(JoinHouseholdResponseSchema, {
            household: {
              id: 'h-new',
              name: req.householdName,
              ownerUserId: 'u-new',
            },
          })
        },
      },
    })

    expect(await screen.findByText('Create your household')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(
      screen.getByRole('link', { name: 'Sign in to accept' }),
    ).toHaveAttribute(
      'href',
      '/login?returnTo=%2Finvite%2Fhousehold%2Fsecret-token',
    )

    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Maya' },
    })
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), {
      target: { value: 'password1234' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create account and continue' }),
    )

    const houseInput = await screen.findByLabelText('Household name')
    fireEvent.change(houseInput, { target: { value: 'Maya House' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(joinedHouseholdName).toBe('Maya House')
  })

  it('sends member-invite magic link with newUserCallbackURL set to /', async () => {
    const magicLink = vi.fn(async () => ({ data: {} }))
    const authClient = createFakeAuthClient({
      signIn: {
        email: vi.fn(async () => ({ data: {} })),
        magicLink,
        passkey: vi.fn(async () => ({ data: {} })),
      },
    })

    renderPortal({
      initialPath: '/invite/member/inv-42',
      unauthenticated: true,
      authClient,
      iamHandlers: {
        getInvite: () =>
          create(GetInviteResponseSchema, {
            kind: InviteKind.MEMBER,
            email: 'member@example.com',
            inviterName: 'Vishrut',
            householdName: 'Agrawal Home',
            role: Role.MEMBER,
            expiresAt: FUTURE,
          }),
      },
    })

    expect(await screen.findByText('Join Agrawal Home')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Magic link' }))
    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Aarav' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Send invite sign-in link' }),
    )

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(magicLink).toHaveBeenCalledWith({
      email: 'member@example.com',
      name: 'Aarav',
      callbackURL: 'http://localhost:3000/invite/member/inv-42',
      newUserCallbackURL: 'http://localhost:3000/',
      errorCallbackURL: 'http://localhost:3000/invite/member/inv-42',
    })
  })

  it('lets a signed-in zero-household user accept a member invite directly', async () => {
    let joined = false
    const { router } = renderPortal({
      initialPath: '/invite/member/inv-99',
      iamHandlers: {
        getInvite: () =>
          create(GetInviteResponseSchema, {
            kind: InviteKind.MEMBER,
            email: 'solo@example.com',
            inviterName: 'Vishrut',
            householdName: 'Agrawal Home',
            role: Role.ADMIN,
            expiresAt: FUTURE,
          }),
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: { id: 'u-solo', name: 'Solo', email: 'solo@example.com' },
            household: joined
              ? { id: 'h-1', name: 'Agrawal Home', ownerUserId: 'u-1' }
              : undefined,
            role: joined ? Role.ADMIN : Role.UNSPECIFIED,
          }),
        joinHousehold: () => {
          joined = true
          return create(JoinHouseholdResponseSchema, {
            household: { id: 'h-1', name: 'Agrawal Home', ownerUserId: 'u-1' },
          })
        },
      },
    })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Join Agrawal Home' }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('prompts mismatched emails to sign out and blocks users already in a household', async () => {
    renderPortal({
      initialPath: '/invite/member/inv-wrong',
      iamHandlers: {
        getInvite: () =>
          create(GetInviteResponseSchema, {
            kind: InviteKind.MEMBER,
            email: 'someone-else@example.com',
            inviterName: 'Vishrut',
            householdName: 'Agrawal Home',
            role: Role.MEMBER,
            expiresAt: FUTURE,
          }),
      },
    })

    expect(await screen.findByText('Wrong account')).toBeInTheDocument()
  })

  it('shows moving-not-supported when signed-in user already belongs to a household', async () => {
    renderPortal({
      initialPath: '/invite/member/inv-in-house',
      iamHandlers: {
        getInvite: () =>
          create(GetInviteResponseSchema, {
            kind: InviteKind.MEMBER,
            email: 'vishrut@example.com',
            inviterName: 'Other',
            householdName: 'Other Home',
            role: Role.MEMBER,
            expiresAt: FUTURE,
          }),
      },
    })

    expect(
      await screen.findByText(/Moving between households is not supported yet/),
    ).toBeInTheDocument()
  })

  it('shows a clear error for expired or invalid invites', async () => {
    renderPortal({
      initialPath: '/invite/household/expired',
      unauthenticated: true,
      iamHandlers: {
        getInvite: () => {
          throw new ConnectError('invite has expired', Code.FailedPrecondition)
        },
      },
    })

    expect(await screen.findByText('Invite unavailable')).toBeInTheDocument()
    expect(screen.getByText('invite has expired')).toBeInTheDocument()
  })
})
