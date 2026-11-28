import { fireEvent, render, screen } from '@testing-library/react'
import {
  FullScreenError,
  FullScreenMessage,
} from '#components/ui/custom/page-states'
import { describe, expect, it, vi } from 'vitest'

describe('FullScreenError', () => {
  it('renders the error message and calls onRetry when clicked', () => {
    const onRetry = vi.fn()
    render(<FullScreenError message="Server offline" onRetry={onRetry} />)

    expect(screen.getByText('Server offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('omits the retry button when onRetry is not provided', () => {
    render(<FullScreenError message="Fatal error" />)

    expect(screen.getByText('Fatal error')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('FullScreenMessage', () => {
  it('renders the message text', () => {
    render(<FullScreenMessage>Page not found.</FullScreenMessage>)
    expect(screen.getByText('Page not found.')).toBeInTheDocument()
  })
})
