import type * as React from 'react'
import { Alert, AlertDescription } from '#components/ui/alert'
import { Button } from '#components/ui/button'
import { Spinner } from '#components/ui/spinner'
import { cn } from '#lib/utils'
import { AlertCircleIcon } from 'lucide-react'

interface FullScreenSpinnerProps {
  className?: string
  spinnerClassName?: string
}

function FullScreenSpinner({
  className,
  spinnerClassName,
}: FullScreenSpinnerProps) {
  return (
    <div
      className={cn('flex min-h-svh items-center justify-center', className)}
    >
      <Spinner className={cn('size-6', spinnerClassName)} />
    </div>
  )
}

interface FullScreenErrorProps {
  message: React.ReactNode
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

function FullScreenError({
  message,
  onRetry,
  retryLabel = 'Retry',
  className,
}: FullScreenErrorProps) {
  return (
    <div
      className={cn(
        'flex min-h-svh items-center justify-center p-6',
        className,
      )}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-3">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

interface FullScreenMessageProps {
  children: React.ReactNode
  className?: string
}

function FullScreenMessage({ children, className }: FullScreenMessageProps) {
  return (
    <div
      className={cn(
        'flex min-h-svh items-center justify-center p-6',
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

export { FullScreenError, FullScreenMessage, FullScreenSpinner }
export type {
  FullScreenErrorProps,
  FullScreenMessageProps,
  FullScreenSpinnerProps,
}
