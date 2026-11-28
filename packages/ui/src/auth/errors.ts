const CODE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Invalid email or password.',
  INVALID_PASSWORD: 'The current password is incorrect.',
  USER_ALREADY_EXISTS:
    'An account with this email already exists. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'An account with this email already exists. Sign in instead.',
  INVALID_TOKEN:
    'That sign-in link is invalid or has expired. Request a new one.',
  TOKEN_EXPIRED: 'That sign-in link has expired. Request a new one.',
  PASSWORD_TOO_SHORT: 'Password is too short. Use at least 8 characters.',
  PASSWORD_TOO_LONG: 'Password is too long.',
  AUTH_CANCELLED: 'Passkey prompt was cancelled.',
  PASSKEY_NOT_FOUND: 'No matching passkey was found for this account.',
}

const INVITE_ONLY_MESSAGE =
  'Sign-up is by invite only. Open an invite link to create an account.'

export function mapAuthError(error: unknown): string {
  const e = (error && typeof error === 'object' ? error : {}) as Record<
    string,
    unknown
  >
  const code = typeof e.code === 'string' ? e.code.toUpperCase() : undefined
  const status = typeof e.status === 'number' ? e.status : undefined
  const name = typeof e.name === 'string' ? e.name : undefined
  const msg = (
    typeof error === 'string'
      ? error
      : typeof e.message === 'string'
        ? e.message
        : ''
  ).trim()

  if (name === 'NotAllowedError' || name === 'AbortError') {
    return 'Passkey prompt was cancelled.'
  }

  const mapped = code ? CODE_MESSAGES[code] : undefined
  if (mapped) {
    return mapped
  }

  if (msg.toLowerCase().includes('sign-up is by invite only')) {
    return INVITE_ONLY_MESSAGE
  }

  if (status === 429) {
    return 'Too many attempts. Wait a moment and try again.'
  }

  if (status === 401) {
    return 'Your session expired. Sign in again.'
  }

  if (name === 'TypeError' && /fetch|network/.test(msg.toLowerCase())) {
    return 'Could not reach the server. Check your connection and try again.'
  }

  return msg || 'Something went wrong. Please try again.'
}

export function mapMagicLinkUrlError(
  errorParam: string | null | undefined,
): string | null {
  const normalized = errorParam?.trim().toUpperCase()
  if (!normalized) {
    return null
  }
  if (
    normalized === 'FORBIDDEN' ||
    normalized === 'SIGNUP_DISABLED' ||
    normalized === 'NEW_USER_SIGNUP_DISABLED'
  ) {
    return INVITE_ONLY_MESSAGE
  }
  return (
    CODE_MESSAGES[normalized] ??
    'That sign-in link could not be verified. Request a new one.'
  )
}
