import { mapAuthError } from '@lumavault/ui/auth'

// Better Auth returns errors as values; throwing lets React Query surface them as mutation and query errors.
export function unwrap<T>(
  res: { data?: T | null; error?: unknown } | null | undefined,
): T | null | undefined {
  if (res?.error) {
    throw new Error(mapAuthError(res.error))
  }
  return res?.data
}
