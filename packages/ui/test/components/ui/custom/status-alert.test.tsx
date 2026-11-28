import { render, screen } from '@testing-library/react'
import { StatusAlert } from '#components/ui/custom/status-alert'
import { describe, expect, it } from 'vitest'

describe('StatusAlert', () => {
  it('renders optional title and description', () => {
    render(<StatusAlert title="Heads up" description="Everything is ready." />)

    expect(screen.getByText('Heads up')).toBeInTheDocument()
    expect(screen.getByText('Everything is ready.')).toBeInTheDocument()
  })

  it('renders destructive alerts with a default error icon', () => {
    const { container } = render(
      <StatusAlert variant="destructive" description="Something failed." />,
    )

    expect(screen.getByText('Something failed.')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
