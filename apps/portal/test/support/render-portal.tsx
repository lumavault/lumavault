import { create } from '@bufbuild/protobuf'
import {
  Code,
  ConnectError,
  createRouterTransport,
  type ServiceImpl,
} from '@connectrpc/connect'
import {
  App,
  GetSetupStatusResponseSchema,
  GetViewerResponseSchema,
  IamService,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import type { AuthClient } from '@lumavault/ui/auth'
import { createQueryClient } from '@lumavault/ui/rpc'
import { createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { createPortalRouter, PortalApp } from '#/router'
import { vi } from 'vitest'

export const DEFAULT_TEST_VIEWER = create(GetViewerResponseSchema, {
  user: {
    id: 'user-1',
    name: 'Vishrut',
    email: 'vishrut@example.com',
    isSuperAdmin: false,
  },
  household: {
    id: 'house-1',
    name: 'Agrawal Home',
    ownerUserId: 'user-1',
    allowance: {
      storageCapBytes: 100n * 1024n ** 3n,
      enabledApps: [App.PHOTOS, App.CINEMA],
      memberLimit: 4,
    },
  },
  role: Role.OWNER,
  usage: {
    usedBytes: 25n * 1024n ** 3n,
    reservedBytes: 5n * 1024n ** 3n,
    remainingBytes: 70n * 1024n ** 3n,
  },
})

export function createFakeIamTransport(
  handlers?: Partial<ServiceImpl<typeof IamService>>,
) {
  return createRouterTransport(({ service }) => {
    service(IamService, {
      getSetupStatus: () =>
        create(GetSetupStatusResponseSchema, {
          needsSetup: false,
          adminEmailRequired: false,
        }),
      getViewer: () => DEFAULT_TEST_VIEWER,
      ...handlers,
    })
  })
}

export function createUnauthenticatedIamTransport(
  handlers?: Partial<ServiceImpl<typeof IamService>>,
) {
  return createFakeIamTransport({
    getViewer: () => {
      throw new ConnectError('sign in required', Code.Unauthenticated)
    },
    ...handlers,
  })
}

export function createFakeAuthClient(
  overrides?: Record<string, unknown>,
): AuthClient {
  return {
    signIn: {
      email: vi.fn(async () => ({ data: {} })),
      magicLink: vi.fn(async () => ({ data: {} })),
      passkey: vi.fn(async () => ({ data: {} })),
    },
    signUp: {
      email: vi.fn(async () => ({ data: {} })),
    },
    signOut: vi.fn(async () => ({ data: {} })),
    changePassword: vi.fn(async () => ({ data: {} })),
    listAccounts: vi.fn(async () => ({
      data: [{ id: 'acc-1', providerId: 'credential' }],
    })),
    passkey: {
      listUserPasskeys: vi.fn(async () => ({ data: [] })),
      addPasskey: vi.fn(async () => ({
        data: { id: 'pk-1', name: 'MacBook' },
      })),
      deletePasskey: vi.fn(async () => ({ data: {} })),
    },
    ...overrides,
  } as unknown as AuthClient
}

export interface RenderPortalOptions {
  initialPath?: string
  iamHandlers?: Partial<ServiceImpl<typeof IamService>>
  unauthenticated?: boolean
  authClient?: AuthClient
}

export function renderPortal(options: RenderPortalOptions = {}) {
  const transport = options.unauthenticated
    ? createUnauthenticatedIamTransport(options.iamHandlers)
    : createFakeIamTransport(options.iamHandlers)
  const queryClient = createQueryClient()
  const authClient = options.authClient ?? createFakeAuthClient()
  const history = createMemoryHistory({
    initialEntries: [options.initialPath ?? '/'],
  })
  const router = createPortalRouter(history)

  const rendered = render(
    <PortalApp
      transport={transport}
      queryClient={queryClient}
      authClient={authClient}
      router={router}
    />,
  )

  return {
    ...rendered,
    router,
    history,
    queryClient,
    authClient,
  }
}
