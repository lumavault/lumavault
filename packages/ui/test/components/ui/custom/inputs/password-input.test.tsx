import { fireEvent, render, screen } from '@testing-library/react'
import { PasswordInput } from '#components/ui/custom/inputs/password-input'
import { describe, expect, it } from 'vitest'

describe('PasswordInput', () => {
  it('toggles visibility between password and text', () => {
    render(<PasswordInput aria-label="Password" defaultValue="secret" />)

    const input = screen.getByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Show password' })

    expect(input).toHaveAttribute('type', 'password')

    fireEvent.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(
      screen.getByRole('button', { name: 'Hide password' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('disables both the input and the toggle button when disabled', () => {
    render(<PasswordInput aria-label="Password" disabled />)

    expect(screen.getByLabelText('Password')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled()
  })
})
