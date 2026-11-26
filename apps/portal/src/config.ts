import { App } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'

export interface PortalConfig {
  apiUrl: string
  portalUrl: string
  appUrls: Record<App.PHOTOS | App.CINEMA | App.ARCADE, string>
  allowedOrigins: string[]
}

const DEFAULT_API_URL = 'http://localhost:4000'
const DEFAULT_PORTAL_URL = 'http://localhost:3000'
const DEFAULT_PHOTOS_URL = 'http://localhost:3001'
const DEFAULT_CINEMA_URL = 'http://localhost:3002'
const DEFAULT_ARCADE_URL = 'http://localhost:3003'

function readEnv(key: string, fallback: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  return value?.trim() ? value.trim() : fallback
}

export function loadPortalConfig(): PortalConfig {
  const apiUrl = readEnv('VITE_API_URL', DEFAULT_API_URL)
  const portalUrl = readEnv('VITE_PORTAL_URL', DEFAULT_PORTAL_URL)
  const photosUrl = readEnv('VITE_PHOTOS_URL', DEFAULT_PHOTOS_URL)
  const cinemaUrl = readEnv('VITE_CINEMA_URL', DEFAULT_CINEMA_URL)
  const arcadeUrl = readEnv('VITE_ARCADE_URL', DEFAULT_ARCADE_URL)

  return {
    apiUrl,
    portalUrl,
    appUrls: {
      [App.PHOTOS]: photosUrl,
      [App.CINEMA]: cinemaUrl,
      [App.ARCADE]: arcadeUrl,
    },
    allowedOrigins: [portalUrl, photosUrl, cinemaUrl, arcadeUrl],
  }
}

export const portalConfig = loadPortalConfig()
