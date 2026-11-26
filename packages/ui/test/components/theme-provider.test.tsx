import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider, useTheme } from '#components/theme-provider'
import { beforeEach, describe, expect, it } from 'vitest'

function ThemeHarness() {
  const { theme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        Dark
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        Light
      </button>
    </div>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('toggles the dark class on the document root', () => {
    render(
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <ThemeHarness />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(document.documentElement).toHaveClass('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
