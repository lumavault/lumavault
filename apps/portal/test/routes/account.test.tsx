import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createFakeAuthClient, renderPortal } from '#test/support/render-portal'
import { describe, expect, it, vi } from 'vitest'

describe('Account route (/account)', () => {
  it('lists, adds, and deletes passkeys and changes password for credential accounts', async () => {
    const passkeys = [
      { id: 'pk-1', name: 'MacBook Air', createdAt: '2026-11-01' },
    ]
    const addPasskey = vi.fn(async (input?: { name?: string }) => {
      const next = {
        id: 'pk-2',
        name: input?.name ?? 'New Key',
        createdAt: '2026-11-26',
      }
      passkeys.push(next)
      return { data: next }
    })
    const deletePasskey = vi.fn(async ({ id }: { id: string }) => {
      const idx = passkeys.findIndex((p) => p.id === id)
      if (idx >= 0) passkeys.splice(idx, 1)
      return { data: {} }
    })
    const changePassword = vi.fn(async () => ({ data: {} }))

    const authClient = createFakeAuthClient({
      changePassword,
      passkey: {
        listUserPasskeys: vi.fn(async () => ({ data: [...passkeys] })),
        addPasskey,
        deletePasskey,
      },
    })

    renderPortal({ initialPath: '/account', authClient })

    expect(await screen.findByText('MacBook Air')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Device label (optional)'), {
      target: { value: 'iPhone' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))

    await waitFor(() => {
      expect(addPasskey).toHaveBeenCalledWith({ name: 'iPhone' })
    })
    expect(await screen.findByText('iPhone')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete MacBook Air' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deletePasskey).toHaveBeenCalledWith({ id: 'pk-1' })
    })

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-password',
        newPassword: 'new-secure-password',
        revokeOtherSessions: false,
      })
    })
    expect(
      await screen.findByText('Your password has been updated.'),
    ).toBeInTheDocument()
  })

  it('hides the password form for passwordless accounts and signs out to /login', async () => {
    const signOut = vi.fn(async () => ({ data: {} }))
    const authClient = createFakeAuthClient({
      listAccounts: vi.fn(async () => ({ data: [] })),
      signOut,
    })

    const { router } = renderPortal({ initialPath: '/account', authClient })

    expect(
      await screen.findByText(/does not have a password set/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(signOut).toHaveBeenCalled()
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('shows an error alert instead of "no password set" when listAccounts fails', async () => {
    const authClient = createFakeAuthClient({
      listAccounts: vi.fn(async () => ({
        error: { status: 401, message: 'Unauthorized' },
      })),
    })

    renderPortal({ initialPath: '/account', authClient })

    expect(
      await screen.findByText('Your session expired. Sign in again.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/does not have a password set/i),
    ).not.toBeInTheDocument()
  })
})
