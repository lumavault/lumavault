const PORTAL_LOOP_PREFIXES = ['/login', '/setup'] as const

export interface ValidateReturnUrlOptions {
  portalOrigin: string
  allowedOrigins: readonly string[]
}

function normalizeOrigin(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

function isPortalLoopPath(pathname: string): boolean {
  return PORTAL_LOOP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

// Validates a return URL against known LumaVault origins. Same-origin Portal paths return
// as relative path+search+hash; allowed cross-origin app URLs return as full URLs.
export function validateReturnUrl(
  raw: string | null | undefined,
  options: ValidateReturnUrlOptions,
): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return null
  }

  // Reject protocol-relative URLs and backslash tricks before URL parsing.
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.includes('\\')
  ) {
    return null
  }

  const portalOrigin = normalizeOrigin(options.portalOrigin)
  if (!portalOrigin) {
    return null
  }

  const allowed = new Set<string>([portalOrigin])
  for (const origin of options.allowedOrigins) {
    const normalized = normalizeOrigin(origin)
    if (normalized) {
      allowed.add(normalized)
    }
  }

  let parsed: URL
  try {
    parsed = trimmed.startsWith('/')
      ? new URL(trimmed, portalOrigin)
      : new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }

  if (parsed.username || parsed.password) {
    return null
  }

  if (!allowed.has(parsed.origin)) {
    return null
  }

  if (parsed.origin === portalOrigin) {
    if (isPortalLoopPath(parsed.pathname)) {
      return null
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  }

  return parsed.toString()
}

export function isSameOriginReturnUrl(validatedUrl: string): boolean {
  return validatedUrl.startsWith('/')
}

export function buildPortalLoginUrl(
  portalUrl: string,
  returnTo?: string | null,
): string {
  const base = portalUrl.replace(/\/+$/, '')
  if (!returnTo) {
    return `${base}/login`
  }
  const params = new URLSearchParams({ returnTo })
  return `${base}/login?${params.toString()}`
}
