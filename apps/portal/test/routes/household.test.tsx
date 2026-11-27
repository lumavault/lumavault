import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  App,
  CancelMemberInviteResponseSchema,
  GetViewerResponseSchema,
  InviteMemberResponseSchema,
  ListMembersResponseSchema,
  Role,
  TransferOwnershipResponseSchema,
  UpdateMemberRoleResponseSchema,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPortal } from '#test/support/render-portal'
import { describe, expect, it, vi } from 'vitest'

describe('Household management route (/household)', () => {
  it('renders an empty state for zero-household users without calling ListMembers', async () => {
    const listMembers = vi.fn()
    renderPortal({
      initialPath: '/household',
      iamHandlers: {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: { id: 'u-solo', name: 'Solo', email: 'solo@example.com' },
          }),
        listMembers,
      },
    })

    expect(await screen.findByText('No household yet')).toBeInTheDocument()
    expect(listMembers).not.toHaveBeenCalled()
  })

  it('shows read-only view to regular Members', async () => {
    renderPortal({
      initialPath: '/household',
      iamHandlers: {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: { id: 'u-2', name: 'Member', email: 'm@example.com' },
            household: {
              id: 'h-1',
              name: 'Agrawal Home',
              ownerUserId: 'u-1',
              allowance: {
                storageCapBytes: 100n * 1024n ** 3n,
                enabledApps: [App.PHOTOS],
                memberLimit: 4,
              },
            },
            role: Role.MEMBER,
            usage: {
              usedBytes: 10n * 1024n ** 3n,
              reservedBytes: 0n,
              remainingBytes: 90n * 1024n ** 3n,
            },
          }),
        listMembers: () =>
          create(ListMembersResponseSchema, {
            members: [
              {
                user: { id: 'u-1', name: 'Alice', email: 'o@example.com' },
                role: Role.OWNER,
              },
              {
                user: { id: 'u-2', name: 'Bob', email: 'm@example.com' },
                role: Role.MEMBER,
              },
            ],
            pendingInvites: [],
            seatsRemaining: 2,
          }),
      },
    })

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Invite members')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Make Owner' }),
    ).not.toBeInTheDocument()
  })

  it('lets Admins invite members, copy the link, cancel invites, and surfaces errors', async () => {
    const invites = [
      { id: 'inv-1', email: 'pending@example.com', role: Role.MEMBER },
    ]
    let seats = 1
    const cancelSpy = vi.fn(() => {
      invites.length = 0
      seats = 2
      return create(CancelMemberInviteResponseSchema, {})
    })

    renderPortal({
      initialPath: '/household',
      iamHandlers: {
        listMembers: () =>
          create(ListMembersResponseSchema, {
            members: [
              {
                user: {
                  id: 'user-1',
                  name: 'Vishrut',
                  email: 'vishrut@example.com',
                },
                role: Role.OWNER,
              },
            ],
            pendingInvites: [...invites],
            seatsRemaining: seats,
          }),
        inviteMember: (req) => {
          if (req.email === 'vishrut@example.com') {
            throw new ConnectError(
              'that person is already a member',
              Code.AlreadyExists,
            )
          }
          invites.push({ id: 'inv-2', email: req.email, role: req.role })
          seats = 0
          return create(InviteMemberResponseSchema, {
            invite: { id: 'inv-2', email: req.email, role: req.role },
            inviteUrl: 'http://localhost:3000/invite/member/inv-2',
          })
        },
        cancelMemberInvite: cancelSpy,
      },
    })

    expect(await screen.findByText('1 seat remaining')).toBeInTheDocument()
    expect(screen.getByText('pending@example.com')).toBeInTheDocument()

    // Existing member error.
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'vishrut@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(
      await screen.findByText('that person is already a member'),
    ).toBeInTheDocument()

    // Valid invite shows copyable link and drops seats to 0.
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'guest@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(
      await screen.findByDisplayValue(
        'http://localhost:3000/invite/member/inv-2',
      ),
    ).toBeInTheDocument()
    expect(await screen.findByText('No seats remaining')).toBeInTheDocument()

    // Cancelling an invite restores seats.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Cancel invite for pending@example.com',
      }),
    )
    expect(await screen.findByText('2 seats remaining')).toBeInTheDocument()
    expect(cancelSpy).toHaveBeenCalled()
    expect(screen.queryByText('pending@example.com')).not.toBeInTheDocument()
  })

  it('lets the Owner transfer ownership and immediately refreshes viewer role controls', async () => {
    let ownerId = 'user-1'
    renderPortal({
      initialPath: '/household',
      iamHandlers: {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: {
              id: 'user-1',
              name: 'Vishrut',
              email: 'vishrut@example.com',
            },
            household: {
              id: 'house-1',
              name: 'Agrawal Home',
              ownerUserId: ownerId,
              allowance: {
                storageCapBytes: 100n * 1024n ** 3n,
                enabledApps: [App.PHOTOS],
                memberLimit: 4,
              },
            },
            role: ownerId === 'user-1' ? Role.OWNER : Role.ADMIN,
            usage: {
              usedBytes: 10n * 1024n ** 3n,
              reservedBytes: 0n,
              remainingBytes: 90n * 1024n ** 3n,
            },
          }),
        listMembers: () =>
          create(ListMembersResponseSchema, {
            members: [
              {
                user: {
                  id: 'user-1',
                  name: 'Vishrut',
                  email: 'vishrut@example.com',
                },
                role: ownerId === 'user-1' ? Role.OWNER : Role.ADMIN,
              },
              {
                user: {
                  id: 'user-2',
                  name: 'Priya',
                  email: 'priya@example.com',
                },
                role: ownerId === 'user-2' ? Role.OWNER : Role.ADMIN,
              },
            ],
            pendingInvites: [],
            seatsRemaining: 2,
          }),
        transferOwnership: (req) => {
          ownerId = req.userId
          return create(TransferOwnershipResponseSchema, {})
        },
      },
    })

    const makeOwnerBtn = await screen.findByRole('button', {
      name: 'Make Owner',
    })
    fireEvent.click(makeOwnerBtn)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Transfer ownership' }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Make Owner' }),
      ).not.toBeInTheDocument()
    })
  })

  it('displays capitalized role labels, promotes a member, and confirms Admin self-demotion', async () => {
    let selfRole = Role.ADMIN
    let bobRole = Role.MEMBER
    const updateMemberRole = vi.fn((req: { userId: string; role: Role }) => {
      if (req.userId === 'user-bob') bobRole = req.role
      if (req.userId === 'user-admin') selfRole = req.role
      return create(UpdateMemberRoleResponseSchema, {})
    })

    renderPortal({
      initialPath: '/household',
      iamHandlers: {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: {
              id: 'user-admin',
              name: 'Dana',
              email: 'dana@example.com',
            },
            household: {
              id: 'house-1',
              name: 'Agrawal Home',
              ownerUserId: 'user-owner',
              allowance: {
                storageCapBytes: 100n * 1024n ** 3n,
                enabledApps: [App.PHOTOS],
                memberLimit: 4,
              },
            },
            role: selfRole,
            usage: {
              usedBytes: 0n,
              reservedBytes: 0n,
              remainingBytes: 100n * 1024n ** 3n,
            },
          }),
        listMembers: () =>
          create(ListMembersResponseSchema, {
            members: [
              {
                user: {
                  id: 'user-owner',
                  name: 'Owner',
                  email: 'owner@example.com',
                },
                role: Role.OWNER,
              },
              {
                user: {
                  id: 'user-admin',
                  name: 'Dana',
                  email: 'dana@example.com',
                },
                role: selfRole,
              },
              {
                user: {
                  id: 'user-bob',
                  name: 'Bob',
                  email: 'bob@example.com',
                },
                role: bobRole,
              },
            ],
            pendingInvites: [],
            seatsRemaining: 1,
          }),
        updateMemberRole,
      },
    })

    const bobSelect = await screen.findByLabelText('Role for Bob')
    expect(bobSelect).toHaveTextContent('Member')

    fireEvent.click(bobSelect)
    const adminOption = await screen.findByRole('option', { name: 'Admin' })
    fireEvent.pointerDown(adminOption)
    fireEvent.mouseDown(adminOption)
    fireEvent.pointerUp(adminOption)
    fireEvent.click(adminOption)
    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-bob', role: Role.ADMIN }),
        expect.anything(),
      )
    })

    const danaSelect = screen.getByLabelText('Role for Dana')
    expect(danaSelect).toHaveTextContent('Admin')

    fireEvent.click(danaSelect)
    const memberOption = await screen.findByRole('option', { name: 'Member' })
    fireEvent.pointerDown(memberOption)
    fireEvent.mouseDown(memberOption)
    fireEvent.pointerUp(memberOption)
    fireEvent.click(memberOption)
    expect(await screen.findByText('Step down from Admin?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Become Member' }))

    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-admin', role: Role.MEMBER }),
        expect.anything(),
      )
    })
  })
})
