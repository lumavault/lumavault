import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { GetViewerResponseSchema } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { navigateToReturnTarget } from '#/routes/login'
import {
  createFakeAuthClient,
  DEFAULT_TEST_VIEWER,
  renderPortal,
} from '#test/support/render-portal'
import { describe, expect, it, vi } from 'vitest'

describe('Login route (/login)', () => {
  it('signs in with password and redirects to a safe same-origin returnTo', async () => {
    let signedIn = false
    const authClient = createFakeAuthClient({
      signIn: {
        email: vi.fn(async () => {
          signedIn = true
          return { data: {} }
        }),
        magicLink: vi.fn(async () => ({ data: {} })),
        passkey: vi.fn(async () => ({ data: {} })),
      },
    })

    const { router } = renderPortal({
      initialPath: '/login?returnTo=%2Fhousehold',
      unauthenticated: true,
      authClient,
      iamHandlers: {
        getViewer: () => {
          if (!signedIn) {
            throw new ConnectError('sign in required', Code.Unauthenticated)
          }
          return DEFAULT_TEST_VIEWER
        },
      },
    })

    expect(await screen.findByText('Sign in to LumaVault')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'vishrut@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), {
      target: { value: 'secret-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/household')
    })
  })

  it('rejects external returnTo URLs and falls back to /', async () => {
    let signedIn = false
    const authClient = createFakeAuthClient({
      signIn: {
        email: vi.fn(async () => {
          signedIn = true
          return { data: {} }
        }),
        magicLink: vi.fn(async () => ({ data: {} })),
        passkey: vi.fn(async () => ({ data: {} })),
      },
    })

    const { router } = renderPortal({
      initialPath: '/login?returnTo=https%3A%2F%2Fevil.example.com%2Fphish',
      unauthenticated: true,
      authClient,
      iamHandlers: {
        getViewer: () => {
          if (!signedIn) {
            throw new ConnectError('sign in required', Code.Unauthenticated)
          }
          return create(GetViewerResponseSchema, DEFAULT_TEST_VIEWER)
        },
      },
    })

    expect(await screen.findByText('Sign in to LumaVault')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'vishrut@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), {
      target: { value: 'secret-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('sends magic link with callbackURL and errorCallbackURL back to /login', async () => {
    const magicLink = vi.fn(async () => ({ data: {} }))
    const authClient = createFakeAuthClient({
      signIn: {
        email: vi.fn(async () => ({ data: {} })),
        magicLink,
        passkey: vi.fn(async () => ({ data: {} })),
      },
    })

    renderPortal({
      initialPath: '/login?returnTo=http%3A%2F%2Flocalhost%3A3001%2Falbums',
      unauthenticated: true,
      authClient,
    })

    fireEvent.click(await screen.findByRole('tab', { name: 'Magic link' }))
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }))

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(magicLink).toHaveBeenCalledWith({
      email: 'user@example.com',
      callbackURL: 'http://localhost:3001/albums',
      errorCallbackURL:
        'http://localhost:3000/login?returnTo=http%3A%2F%2Flocalhost%3A3001%2Falbums',
    })
  })

  it('displays magic-link URL errors and handles cancelled passkey prompts', async () => {
    const authClient = createFakeAuthClient({
      signIn: {
        email: vi.fn(async () => ({ data: {} })),
        magicLink: vi.fn(async () => ({ data: {} })),
        passkey: vi.fn(async () => {
          const err = new Error('The operation was not allowed.')
          err.name = 'NotAllowedError'
          throw err
        }),
      },
    })

    renderPortal({
      initialPath: '/login?error=EXPIRED_TOKEN',
      unauthenticated: true,
      authClient,
    })

    expect(
      await screen.findByText(/sign-in link has expired/i),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with a passkey' }),
    )
    expect(
      await screen.findByText('Passkey prompt was cancelled.'),
    ).toBeInTheDocument()
  })

  it('uses router navigation for same-origin targets and browser redirect for cross-origin apps', () => {
    const routerNav = vi.fn(async () => {})
    const external = vi.fn()

    navigateToReturnTarget('/pair', routerNav, external)
    expect(routerNav).toHaveBeenCalledWith({ href: '/pair', replace: true })
    expect(external).not.toHaveBeenCalled()

    navigateToReturnTarget('http://localhost:3001/albums', routerNav, external)
    expect(external).toHaveBeenCalledWith('http://localhost:3001/albums')
  })
})
