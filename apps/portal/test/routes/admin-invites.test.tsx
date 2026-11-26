import { create } from '@bufbuild/protobuf'
import {
  App,
  CreateHouseholdInviteResponseSchema,
  GetViewerResponseSchema,
  ListHouseholdInvitesResponseSchema,
  RevokeHouseholdInviteResponseSchema,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPortal } from '#test/support/render-portal'
import { describe, expect, it } from 'vitest'

const ADMIN_VIEWER = create(GetViewerResponseSchema, {
  user: {
    id: 'admin-1',
    name: 'Server Owner',
    email: 'admin@example.com',
    isSuperAdmin: true,
  },
  household: {
    id: 'house-1',
    name: 'Owner Home',
    ownerUserId: 'admin-1',
    allowance: {
      storageCapBytes: 500n * 1024n ** 3n,
      enabledApps: [App.PHOTOS],
      memberLimit: 4,
    },
  },
  role: Role.OWNER,
})

describe('Super-Admin invites route (/admin/invites)', () => {
  it('creates a household invite showing the one-time link and revokes existing invites', async () => {
    const openInvites = [
      {
        id: 'inv-old',
        email: 'parents@example.com',
        allowance: {
          storageCapBytes: 200n * 1024n ** 3n,
          enabledApps: [App.PHOTOS, App.CINEMA],
          memberLimit: 4,
        },
        note: 'Parents',
      },
    ]

    renderPortal({
      initialPath: '/admin/invites',
      iamHandlers: {
        getViewer: () => ADMIN_VIEWER,
        listHouseholdInvites: () =>
          create(ListHouseholdInvitesResponseSchema, {
            invites: [...openInvites],
          }),
        createHouseholdInvite: (req) => {
          const created = {
            id: 'inv-new',
            email: req.email,
            allowance: {
              storageCapBytes: req.allowance?.storageCapBytes ?? 0n,
              enabledApps: [...(req.allowance?.enabledApps ?? [])],
              memberLimit: req.allowance?.memberLimit ?? 4,
            },
            note: req.note,
          }
          openInvites.push(created)
          return create(CreateHouseholdInviteResponseSchema, {
            invite: created,
            inviteUrl: 'http://localhost:3000/invite/household/one-time-secret',
          })
        },
        revokeHouseholdInvite: (req) => {
          const idx = openInvites.findIndex((i) => i.id === req.inviteId)
          if (idx >= 0) openInvites.splice(idx, 1)
          return create(RevokeHouseholdInviteResponseSchema, {})
        },
      },
    })

    expect(await screen.findByText('parents@example.com')).toBeInTheDocument()

    // Create new invite.
    fireEvent.click(
      screen.getByRole('button', { name: 'New household invite' }),
    )
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'friend@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'Best friend' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }))

    expect(
      await screen.findByDisplayValue(
        'http://localhost:3000/invite/household/one-time-secret',
      ),
    ).toBeInTheDocument()
    expect(await screen.findByText('friend@example.com')).toBeInTheDocument()

    // Revoke first invite.
    const revokeBtns = screen.getAllByRole('button', { name: 'Revoke' })
    fireEvent.click(revokeBtns[0]!)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Revoke invite' }),
    )

    await waitFor(() => {
      expect(screen.queryByText('parents@example.com')).not.toBeInTheDocument()
    })
  })
})
