import {
  buildPortalLoginUrl,
  isSameOriginReturnUrl,
  mapAuthError,
  mapMagicLinkUrlError,
  validateReturnUrl,
} from '#auth'
import { describe, expect, it } from 'vitest'

const OPTIONS = {
  portalOrigin: 'http://localhost:3000',
  allowedOrigins: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
  ],
}

describe('validateReturnUrl', () => {
  it('accepts relative Portal paths and returns path with search and hash', () => {
    const result = validateReturnUrl('/household?tab=invites#pending', OPTIONS)
    expect(result).toBe('/household?tab=invites#pending')
    expect(isSameOriginReturnUrl(result!)).toBe(true)
  })

  it('accepts same-origin full Portal URLs as relative paths', () => {
    const result = validateReturnUrl(
      'http://localhost:3000/pair?code=ABC123',
      OPTIONS,
    )
    expect(result).toBe('/pair?code=ABC123')
    expect(isSameOriginReturnUrl(result!)).toBe(true)
  })

  it('accepts allowed cross-origin LumaVault app URLs', () => {
    const result = validateReturnUrl('http://localhost:3001/albums/42', OPTIONS)
    expect(result).toBe('http://localhost:3001/albums/42')
    expect(isSameOriginReturnUrl(result!)).toBe(false)
  })

  it('rejects outside domains, protocol-relative URLs, non-HTTP schemes, and credentials', () => {
    expect(
      validateReturnUrl('https://evil.example.com/phish', OPTIONS),
    ).toBeNull()
    expect(validateReturnUrl('//evil.example.com/phish', OPTIONS)).toBeNull()
    expect(validateReturnUrl('/\\evil.example.com', OPTIONS)).toBeNull()
    expect(validateReturnUrl('javascript:alert(1)', OPTIONS)).toBeNull()
    expect(validateReturnUrl('data:text/html,<script>', OPTIONS)).toBeNull()
    expect(
      validateReturnUrl('http://user:pass@localhost:3001/', OPTIONS),
    ).toBeNull()
  })

  it('rejects Portal /login and /setup loop targets', () => {
    expect(validateReturnUrl('/login', OPTIONS)).toBeNull()
    expect(validateReturnUrl('/login?returnTo=/', OPTIONS)).toBeNull()
    expect(validateReturnUrl('http://localhost:3000/setup', OPTIONS)).toBeNull()
  })

  it('builds Portal login URLs with returnTo', () => {
    expect(buildPortalLoginUrl('http://localhost:3000/', '/pair')).toBe(
      'http://localhost:3000/login?returnTo=%2Fpair',
    )
    expect(buildPortalLoginUrl('http://localhost:3000')).toBe(
      'http://localhost:3000/login',
    )
  })
})

describe('mapAuthError', () => {
  it('maps Better Auth codes, 403 invite-only, 429 rate limit, and cancelled passkeys', () => {
    expect(mapAuthError({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe(
      'Invalid email or password.',
    )
    expect(
      mapAuthError({ status: 403, message: 'sign-up is by invite only' }),
    ).toContain('invite only')
    expect(mapAuthError({ status: 429 })).toContain('Too many attempts')
    expect(mapAuthError({ code: 'USER_ALREADY_EXISTS' })).toContain(
      'Sign in instead',
    )

    const cancelled = new Error(
      'The operation either timed out or was not allowed.',
    )
    cancelled.name = 'NotAllowedError'
    expect(mapAuthError(cancelled)).toBe('Passkey prompt was cancelled.')
  })

  it('maps magic link error query params', () => {
    expect(mapMagicLinkUrlError('EXPIRED_TOKEN')).toContain('expired')
    expect(mapMagicLinkUrlError('FORBIDDEN')).toContain('invite only')
    expect(mapMagicLinkUrlError(null)).toBeNull()
  })
})
