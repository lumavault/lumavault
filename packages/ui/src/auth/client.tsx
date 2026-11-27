import * as React from 'react'
import { passkeyClient } from '@better-auth/passkey/client'
import { magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient as createBetterAuthClient } from 'better-auth/react'

const AUTH_BASE_PATH = '/api/auth'

function createAuthClient(apiUrl: string) {
  return createBetterAuthClient({
    baseURL: apiUrl.replace(/\/+$/, ''),
    basePath: AUTH_BASE_PATH,
    fetchOptions: {
      credentials: 'include',
    },
    plugins: [passkeyClient(), magicLinkClient()],
  })
}

export type AuthClient = ReturnType<typeof createAuthClient>

interface AuthConfig {
  apiUrl: string
  portalUrl: string
  allowedOrigins: readonly string[]
}

interface AuthContextValue {
  authClient: AuthClient
  config: AuthConfig
}

// Stable default so the context value and guard effects do not change every render.
const NO_ALLOWED_ORIGINS: readonly string[] = Object.freeze([])

const AuthContext = React.createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  apiUrl: string
  portalUrl: string
  allowedOrigins?: readonly string[]
  authClient?: AuthClient
  children: React.ReactNode
}

export function AuthProvider({
  apiUrl,
  portalUrl,
  allowedOrigins = NO_ALLOWED_ORIGINS,
  authClient,
  children,
}: AuthProviderProps) {
  const resolvedClient = React.useMemo(
    () => authClient ?? createAuthClient(apiUrl),
    [apiUrl, authClient],
  )
  const value = React.useMemo<AuthContextValue>(
    () => ({
      authClient: resolvedClient,
      config: {
        apiUrl,
        portalUrl,
        allowedOrigins,
      },
    }),
    [resolvedClient, apiUrl, portalUrl, allowedOrigins],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthClient(): AuthClient {
  const ctx = React.useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthClient must be used inside AuthProvider')
  }
  return ctx.authClient
}

export function useAuthConfig(): AuthConfig {
  const ctx = React.useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthConfig must be used inside AuthProvider')
  }
  return ctx.config
}
