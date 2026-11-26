import { isBearerToken } from '#/lib/secrets.js'
import { describe, expect, it } from 'vitest'

describe('isBearerToken', () => {
  it('accepts three non-empty dot-separated JWT segments', () => {
    expect(isBearerToken('header.payload.signature')).toBe(true)
    expect(
      isBearerToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-123_abc'),
    ).toBe(true)
  })

  it('rejects plain API keys and empty strings', () => {
    expect(isBearerToken('1234567890abcdef1234567890abcdef')).toBe(false)
    expect(isBearerToken('')).toBe(false)
  })

  it('rejects tokens with empty segments or leading/trailing dots', () => {
    expect(isBearerToken('a..b')).toBe(false)
    expect(isBearerToken('.a.b')).toBe(false)
    expect(isBearerToken('a.b.')).toBe(false)
    expect(isBearerToken('..')).toBe(false)
  })

  it('rejects tokens that do not have exactly three segments', () => {
    expect(isBearerToken('header.payload')).toBe(false)
    expect(isBearerToken('a.b.c.d')).toBe(false)
  })
})
