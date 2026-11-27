export interface AuthErrorShape {
  code?: string | null
  status?: number | null
  statusText?: string | null
  message?: string | null
  name?: string | null
}

const CODE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Invalid email or password.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  INVALID_PASSWORD: 'The current password is incorrect.',
  USER_ALREADY_EXISTS:
    'An account with this email already exists. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'An account with this email already exists. Sign in instead.',
  INVALID_TOKEN:
    'That sign-in link is invalid or has expired. Request a new one.',
  EXPIRED_TOKEN: 'That sign-in link has expired. Request a new one.',
  TOKEN_EXPIRED: 'That sign-in link has expired. Request a new one.',
  PASSWORD_TOO_SHORT: 'Password is too short. Use at least 8 characters.',
  PASSWORD_TOO_LONG: 'Password is too long.',
  TOO_MANY_REQUESTS: 'Too many attempts. Wait a moment and try again.',
  AUTH_CANCELLED: 'Passkey prompt was cancelled.',
  PASSKEY_NOT_FOUND: 'No matching passkey was found for this account.',
}

function asErrorShape(error: unknown): AuthErrorShape {
  if (!error || typeof error !== 'object') {
    return { message: typeof error === 'string' ? error : undefined }
  }
  const record = error as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    status: typeof record.status === 'number' ? record.status : undefined,
    statusText:
      typeof record.statusText === 'string' ? record.statusText : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
  }
}

function isCancelledPasskey(shape: AuthErrorShape): boolean {
  if (shape.name === 'NotAllowedError' || shape.name === 'AbortError') {
    return true
  }
  const msg = shape.message?.toLowerCase() ?? ''
  return (
    msg.includes('not allowed') ||
    msg.includes('timed out or was not allowed') ||
    msg.includes('ceremony was aborted') ||
    msg.includes('auth_cancelled')
  )
}

function isInviteOnlyError(shape: AuthErrorShape): boolean {
  const msg = shape.message?.toLowerCase() ?? ''
  return msg.includes('sign-up is by invite only')
}

export function mapAuthError(error: unknown): string {
  const shape = asErrorShape(error)

  if (isCancelledPasskey(shape)) {
    return 'Passkey prompt was cancelled.'
  }

  if (shape.code) {
    const normalized = shape.code.toUpperCase()
    const mapped = CODE_MESSAGES[normalized]
    if (mapped) {
      return mapped
    }
  }

  if (isInviteOnlyError(shape)) {
    return 'Sign-up is by invite only. Open an invite link to create an account.'
  }

  if (shape.status === 429) {
    return 'Too many attempts. Wait a moment and try again.'
  }

  if (shape.status === 401) {
    return shape.message?.toLowerCase().includes('password')
      ? 'Invalid email or password.'
      : 'Your session expired. Sign in again.'
  }

  const msg = shape.message?.trim() ?? ''
  if (
    shape.name === 'TypeError' &&
    (msg.toLowerCase().includes('fetch') ||
      msg.toLowerCase().includes('network'))
  ) {
    return 'Could not reach the server. Check your connection and try again.'
  }

  if (msg) {
    return msg
  }

  return 'Something went wrong. Please try again.'
}

export function mapMagicLinkUrlError(
  errorParam: string | null | undefined,
): string | null {
  if (!errorParam) {
    return null
  }
  const normalized = errorParam.trim().toUpperCase()
  if (!normalized) {
    return null
  }
  if (normalized === 'FORBIDDEN' || normalized === 'SIGNUP_DISABLED') {
    return 'Sign-up is by invite only. Open an invite link to create an account.'
  }
  return (
    CODE_MESSAGES[normalized] ??
    'That sign-in link could not be verified. Request a new one.'
  )
}
