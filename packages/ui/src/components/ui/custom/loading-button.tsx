import type * as React from 'react'
import { Button } from '#components/ui/button'
import { Spinner } from '#components/ui/spinner'

type LoadingButtonProps = React.ComponentProps<typeof Button> & {
  loading?: boolean
  icon?: React.ReactNode
}

function LoadingButton({
  loading = false,
  icon,
  disabled,
  children,
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner data-icon="inline-start" aria-hidden="true" /> : icon}
      {children}
    </Button>
  )
}

export { LoadingButton }
export type { LoadingButtonProps }
