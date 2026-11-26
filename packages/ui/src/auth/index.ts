export {
  AUTH_BASE_PATH,
  AuthProvider,
  createAuthClient,
  useAuthClient,
  useAuthConfig,
  type AuthClient,
  type AuthConfig,
  type AuthProviderProps,
} from './client'
export {
  mapAuthError,
  mapMagicLinkUrlError,
  type AuthErrorShape,
} from './errors'
export { useRefreshViewer, useSignOut } from './hooks'
export {
  buildPortalLoginUrl,
  isSameOriginReturnUrl,
  validateReturnUrl,
  type ValidateReturnUrlOptions,
} from './return-url'
export { AuthGuard, type AuthGuardProps } from './route-guard'
export {
  changePasswordSchema,
  emailSchema,
  magicLinkSchema,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordSchema,
  signInPasswordSchema,
  signUpPasswordSchema,
  type ChangePasswordInput,
  type MagicLinkInput,
  type SignInPasswordInput,
  type SignUpPasswordInput,
} from './schemas'
