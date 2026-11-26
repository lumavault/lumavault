import { cn } from '#lib/utils'
import { describe, expect, it } from 'vitest'

describe('cn', () => {
  it('merges conditional classes and resolves Tailwind conflicts', () => {
    const isActive = true
    const isHidden = false
    expect(cn('px-2 py-1', isActive && 'px-4', isHidden && 'hidden')).toBe(
      'py-1 px-4',
    )
  })
})
