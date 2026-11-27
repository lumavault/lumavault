import { App } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'

export interface PortalConfig {
  apiUrl: string
  portalUrl: string
  appUrls: Record<App.PHOTOS | App.CINEMA | App.ARCADE, string>
  allowedOrigins: string[]
}

const env = import.meta.env
const portalUrl = env.VITE_PORTAL_URL?.trim() || 'http://localhost:3000'
const photosUrl = env.VITE_PHOTOS_URL?.trim() || 'http://localhost:3001'
const cinemaUrl = env.VITE_CINEMA_URL?.trim() || 'http://localhost:3002'
const arcadeUrl = env.VITE_ARCADE_URL?.trim() || 'http://localhost:3003'

export const portalConfig: PortalConfig = {
  apiUrl: env.VITE_API_URL?.trim() || 'http://localhost:4000',
  portalUrl,
  appUrls: {
    [App.PHOTOS]: photosUrl,
    [App.CINEMA]: cinemaUrl,
    [App.ARCADE]: arcadeUrl,
  },
  allowedOrigins: [portalUrl, photosUrl, cinemaUrl, arcadeUrl],
}
