import * as React from 'react'
import { Button } from '@lumavault/ui/components/ui/button'

export function useCursorPagination() {
  const [pageToken, setPageToken] = React.useState('')
  const [pageHistory, setPageHistory] = React.useState<string[]>([])

  const goPrevious = React.useCallback(() => {
    setPageHistory((prev) => {
      if (prev.length === 0) return prev
      const next = prev.slice(0, -1)
      setPageToken(prev[prev.length - 1] ?? '')
      return next
    })
  }, [])

  const goNext = React.useCallback(
    (nextToken: string) => {
      if (!nextToken) return
      setPageHistory((prev) => [...prev, pageToken])
      setPageToken(nextToken)
    },
    [pageToken],
  )

  return {
    pageToken,
    hasPrevious: pageHistory.length > 0,
    goPrevious,
    goNext,
  }
}

export interface CursorPaginationProps {
  hasPrevious: boolean
  nextPageToken: string
  onPrevious: () => void
  onNext: (nextToken: string) => void
}

export function CursorPagination({
  hasPrevious,
  nextPageToken,
  onPrevious,
  onNext,
}: CursorPaginationProps) {
  if (!hasPrevious && !nextPageToken) {
    return null
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasPrevious}
        onClick={onPrevious}
      >
        Previous
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!nextPageToken}
        onClick={() => onNext(nextPageToken)}
      >
        Next
      </Button>
    </div>
  )
}
