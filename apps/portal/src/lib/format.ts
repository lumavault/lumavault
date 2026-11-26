import { ConnectError } from '@connectrpc/connect'

export function rpcErrorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof ConnectError) {
    return err.rawMessage
  }
  if (err instanceof Error && err.message) {
    return err.message
  }
  return fallback
}

export function formatDate(
  value: { seconds: bigint } | Date | string | null | undefined,
  fallback = '—',
): string {
  if (!value) return fallback
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : new Date(Number(value.seconds) * 1000)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function zodFieldErrors<K extends string>(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
}): Partial<Record<K, string>> {
  const next: Partial<Record<K, string>> = {}
  for (const issue of error.issues) {
    const key = issue.path[0] as K | undefined
    if (key && !next[key]) {
      next[key] = issue.message
    }
  }
  return next
}
