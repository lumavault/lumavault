import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { viewerQueryKey } from '#household'

import { useAuthClient } from './client'
import { mapAuthError } from './errors'

// Invalidates GetViewer after sign-in or sign-up so guards refetch the new session.
export function useRefreshViewer() {
  const queryClient = useQueryClient()
  return React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: viewerQueryKey() })
  }, [queryClient])
}

export function useSignOut() {
  const authClient = useAuthClient()
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const signOut = React.useCallback(async (): Promise<boolean> => {
    setIsPending(true)
    setError(null)
    try {
      // Cancel in-flight requests before signing out so slow responses cannot repopulate cache.
      await queryClient.cancelQueries()
      const result = await authClient.signOut()
      if (result.error) {
        setError(mapAuthError(result.error))
        return false
      }
      queryClient.clear()
      return true
    } catch (err) {
      setError(mapAuthError(err))
      return false
    } finally {
      setIsPending(false)
    }
  }, [authClient, queryClient])

  return {
    signOut,
    isPending,
    error,
  }
}
