import { render, screen } from '@testing-library/react'
import { Button } from '#components/ui/button'
import { describe, expect, it } from 'vitest'

describe('Button', () => {
  it('renders Base UI button with data-slot and custom className', () => {
    render(
      <Button variant="outline" size="sm" className="custom-btn">
        Save
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button).toHaveClass('custom-btn')
  })
})
