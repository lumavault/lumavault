import * as React from 'react'
import { Button } from '@lumavault/ui/components/ui/button'

export function useCursorPagination() {
  // Stack of page tokens visited; the top is the current page and '' is the first page.
  const [stack, setStack] = React.useState<string[]>([''])

  const goPrevious = React.useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  const goNext = React.useCallback((nextToken: string) => {
    if (!nextToken) return
    setStack((prev) => [...prev, nextToken])
  }, [])

  return {
    pageToken: stack.at(-1) ?? '',
    hasPrevious: stack.length > 1,
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
