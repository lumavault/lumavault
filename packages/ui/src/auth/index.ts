export {
  AuthProvider,
  useAuthClient,
  useAuthConfig,
  type AuthClient,
} from './client'
export { mapAuthError, mapMagicLinkUrlError } from './errors'
export { useRefreshViewer, useSignOut } from './hooks'
export {
  buildPortalLoginUrl,
  isSameOriginReturnUrl,
  validateReturnUrl,
} from './return-url'
export { AuthGuard } from './route-guard'
export {
  changePasswordSchema,
  emailSchema,
  magicLinkSchema,
  passwordSchema,
  signInPasswordSchema,
  signUpPasswordSchema,
} from './schemas'
