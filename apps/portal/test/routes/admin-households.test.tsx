import { create } from '@bufbuild/protobuf'
import {
  App,
  GetViewerResponseSchema,
  ListHouseholdsResponseSchema,
  Role,
  UpdateHouseholdAllowanceResponseSchema,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { MAX_STORAGE_CAP_BYTES } from '@lumavault/ui/lib/format-bytes'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPortal } from '#test/support/render-portal'
import { describe, expect, it, vi } from 'vitest'

function superAdminViewer(memberLimit = 4) {
  return create(GetViewerResponseSchema, {
    user: {
      id: 'admin-1',
      name: 'Server Owner',
      email: 'admin@example.com',
      isSuperAdmin: true,
    },
    household: {
      id: 'house-admin',
      name: 'Owner Home',
      ownerUserId: 'admin-1',
      allowance: {
        storageCapBytes: MAX_STORAGE_CAP_BYTES,
        enabledApps: [App.PHOTOS, App.CINEMA, App.ARCADE],
        memberLimit,
      },
    },
    role: Role.OWNER,
    usage: {
      usedBytes: 10n * 1024n ** 3n,
      reservedBytes: 0n,
      remainingBytes: MAX_STORAGE_CAP_BYTES - 10n * 1024n ** 3n,
    },
  })
}

describe('Super-Admin households route (/admin/households)', () => {
  it('blocks non-Super-Admins from opening /admin/households', async () => {
    const listHouseholds = vi.fn()
    renderPortal({
      initialPath: '/admin/households',
      iamHandlers: {
        listHouseholds,
      },
    })

    expect(
      await screen.findByText('Super-Admin access required'),
    ).toBeInTheDocument()
    expect(listHouseholds).not.toHaveBeenCalled()
  })

  it('preserves the unlimited setup cap, sends only changed mask fields, and refreshes viewer for own household', async () => {
    let viewerCalls = 0
    let currentLimit = 4
    let receivedPaths: string[] = []
    let receivedCap = 0n

    renderPortal({
      initialPath: '/admin/households',
      iamHandlers: {
        getViewer: () => {
          viewerCalls += 1
          return superAdminViewer(currentLimit)
        },
        listHouseholds: () =>
          create(ListHouseholdsResponseSchema, {
            households: [
              {
                household: {
                  id: 'house-admin',
                  name: 'Owner Home',
                  ownerUserId: 'admin-1',
                  allowance: {
                    storageCapBytes: MAX_STORAGE_CAP_BYTES,
                    enabledApps: [App.PHOTOS, App.CINEMA, App.ARCADE],
                    memberLimit: currentLimit,
                  },
                },
                owner: {
                  id: 'admin-1',
                  name: 'Server Owner',
                  email: 'admin@example.com',
                  isSuperAdmin: true,
                },
                usage: {
                  usedBytes: 10n * 1024n ** 3n,
                  reservedBytes: 0n,
                  remainingBytes: MAX_STORAGE_CAP_BYTES - 10n * 1024n ** 3n,
                },
                memberCount: 1,
                pendingInviteCount: 0,
              },
            ],
          }),
        updateHouseholdAllowance: (req) => {
          receivedPaths = [...(req.updateMask?.paths ?? [])]
          receivedCap = req.allowance?.storageCapBytes ?? 0n
          currentLimit = req.allowance?.memberLimit ?? currentLimit
          return create(UpdateHouseholdAllowanceResponseSchema, {
            household: {
              id: req.householdId,
              name: 'Owner Home',
              ownerUserId: 'admin-1',
              allowance: req.allowance,
            },
          })
        },
      },
    })

    const editBtn = await screen.findByRole('button', {
      name: 'Edit allowance',
    })
    fireEvent.click(editBtn)

    // Save is disabled when nothing has changed (never sends empty mask).
    const saveBtn = await screen.findByRole('button', { name: 'Save changes' })
    expect(saveBtn).toBeDisabled()

    // Change only member limit; unlimited setup cap remains untouched.
    fireEvent.change(screen.getByLabelText('Member limit'), {
      target: { value: '8' },
    })
    expect(saveBtn).toBeEnabled()

    const viewerCallsBefore = viewerCalls
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(receivedPaths).toEqual(['member_limit'])
    })
    expect(receivedCap).toBe(MAX_STORAGE_CAP_BYTES)
    await waitFor(() => {
      expect(viewerCalls).toBeGreaterThan(viewerCallsBefore)
    })
  })
})
