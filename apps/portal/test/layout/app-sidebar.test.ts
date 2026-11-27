import { initialsFor } from '#/layout/app-sidebar'
import { describe, expect, it } from 'vitest'

describe('initialsFor', () => {
  it('uses name words when present', () => {
    expect(initialsFor('Ada Lovelace', 'ada@example.com')).toBe('AL')
  })

  it('falls back to the email when the name is missing', () => {
    expect(initialsFor(undefined, 'vish@example.com')).toBe('VI')
    expect(initialsFor('', 'vish@example.com')).toBe('VI')
  })
})
