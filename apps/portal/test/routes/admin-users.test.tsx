import { create } from '@bufbuild/protobuf'
import {
  App,
  GetViewerResponseSchema,
  ListUsersResponseSchema,
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

describe('Super-Admin users route (/admin/users)', () => {
  it('searches users by query and paginates with nextPageToken', async () => {
    renderPortal({
      initialPath: '/admin/users',
      iamHandlers: {
        getViewer: () => ADMIN_VIEWER,
        listUsers: (req) => {
          if (req.query === 'maya') {
            return create(ListUsersResponseSchema, {
              users: [
                {
                  id: 'u-maya',
                  name: 'Maya Patel',
                  email: 'maya@example.com',
                  isSuperAdmin: false,
                },
              ],
            })
          }
          if (req.pageToken === 'page-2') {
            return create(ListUsersResponseSchema, {
              users: [
                {
                  id: 'u-2',
                  name: 'Second Page User',
                  email: 'page2@example.com',
                  isSuperAdmin: false,
                },
              ],
            })
          }
          return create(ListUsersResponseSchema, {
            users: [
              {
                id: 'admin-1',
                name: 'Server Owner',
                email: 'admin@example.com',
                isSuperAdmin: true,
              },
            ],
            nextPageToken: 'page-2',
          })
        },
      },
    })

    expect(await screen.findByText('Server Owner')).toBeInTheDocument()

    // Paginate to page 2.
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Second Page User')).toBeInTheDocument()

    // Search resets pagination and filters.
    fireEvent.change(screen.getByLabelText('Search users'), {
      target: { value: 'maya' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('Maya Patel')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Second Page User')).not.toBeInTheDocument()
    })
  })
})
