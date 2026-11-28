import { render, screen } from '@testing-library/react'
import { LoadingButton } from '#components/ui/custom/loading-button'
import { describe, expect, it } from 'vitest'

describe('LoadingButton', () => {
  it('disables the button and swaps the icon for a spinner while loading', () => {
    const { rerender } = render(
      <LoadingButton icon={<span data-testid="btn-icon" />}>
        Save
      </LoadingButton>,
    )

    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    expect(screen.getByTestId('btn-icon')).toBeInTheDocument()

    rerender(
      <LoadingButton loading icon={<span data-testid="btn-icon" />}>
        Save
      </LoadingButton>,
    )

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('btn-icon')).not.toBeInTheDocument()
  })
})
