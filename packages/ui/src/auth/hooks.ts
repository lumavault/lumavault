import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  const mutation = useMutation({
    // Cancel in-flight requests before signing out so slow responses cannot repopulate cache.
    onMutate: () => queryClient.cancelQueries(),
    mutationFn: async () => {
      const result = await authClient.signOut()
      if (result.error) {
        throw result.error
      }
    },
    onSuccess: () => queryClient.clear(),
  })
  const { mutateAsync } = mutation

  const signOut = React.useCallback(
    () =>
      mutateAsync().then(
        () => true,
        () => false,
      ),
    [mutateAsync],
  )

  return {
    signOut,
    isPending: mutation.isPending,
    error: mutation.error ? mapAuthError(mutation.error) : null,
  }
}
