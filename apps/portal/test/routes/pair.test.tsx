import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  ApprovePairingResponseSchema,
  GetViewerResponseSchema,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPortal } from '#test/support/render-portal'
import { describe, expect, it } from 'vitest'

describe('Apple TV pairing route (/pair)', () => {
  it('normalizes the code, submits ApprovePairing, and shows the approved device name', async () => {
    let receivedCode = ''
    renderPortal({
      initialPath: '/pair',
      iamHandlers: {
        approvePairing: (req) => {
          receivedCode = req.code
          return create(ApprovePairingResponseSchema, {
            deviceName: 'Living Room',
          })
        },
      },
    })

    const input = await screen.findByLabelText('Pairing code')
    fireEvent.change(input, { target: { value: 'ab23cd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve Apple TV' }))

    expect(await screen.findByText('TV signed in')).toBeInTheDocument()
    expect(
      screen.getByText(/Living Room is now signed in to Agrawal Home/),
    ).toBeInTheDocument()
    expect(receivedCode).toBe('AB23CD')
  })

  it('shows clear errors for wrong/expired codes and rate limits', async () => {
    let attempts = 0
    renderPortal({
      initialPath: '/pair',
      iamHandlers: {
        approvePairing: () => {
          attempts += 1
          if (attempts === 1) {
            throw new ConnectError(
              'that code is wrong or expired',
              Code.NotFound,
            )
          }
          throw new ConnectError('too many attempts', Code.ResourceExhausted)
        },
      },
    })

    const input = await screen.findByLabelText('Pairing code')
    fireEvent.change(input, { target: { value: 'ABCDEF' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve Apple TV' }))

    expect(
      await screen.findByText(/code is wrong, expired, or already used/i),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve Apple TV' }))
    await waitFor(() => {
      expect(screen.getByText(/too many pairing attempts/i)).toBeInTheDocument()
    })
  })

  it('shows an empty state when the user has no household', async () => {
    renderPortal({
      initialPath: '/pair',
      iamHandlers: {
        getViewer: () =>
          create(GetViewerResponseSchema, {
            user: { id: 'u-solo', name: 'Solo', email: 'solo@example.com' },
          }),
      },
    })

    expect(
      await screen.findByText('Join a household first'),
    ).toBeInTheDocument()
  })
})
