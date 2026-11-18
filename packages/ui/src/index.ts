// @lumavault/ui: headless building blocks shared by the four web apps. Behavior and
// accessibility come from Base UI; every app brings its own styles, so nothing here sets a
// color, font, or layout.

// Primitives, unstyled. Style them with className or the data attributes Base UI sets.
export { Dialog } from "@base-ui/react/dialog";
export { Menu } from "@base-ui/react/menu";
export { Progress } from "@base-ui/react/progress";
export { Select } from "@base-ui/react/select";
export { Switch } from "@base-ui/react/switch";
export { Tabs } from "@base-ui/react/tabs";
export { Toast } from "@base-ui/react/toast";
export { Tooltip } from "@base-ui/react/tooltip";

// API access and the active household.
export { createApiTransport, LumaVaultProvider, type LumaVaultProviderProps } from "./rpc/provider.js";
export { useHousehold, useJoinHousehold, useLeaveHousehold, useViewer, type ViewerHousehold } from "./household/use-household.js";
export { formatBytes, summarizeUsage, type UsageSummary } from "./format-bytes.js";

// Sign-in logic with no look attached. Each app builds its own forms on these hooks.
export { createLumaVaultAuthClient, type LumaVaultAuthClient } from "./auth/client.js";
export { AUTH_BASE_PATH, PORTAL_LOGIN_PATH, RETURN_TO_PARAM } from "./auth/constants.js";
export { type AuthErrorLike, authErrorMessage } from "./auth/errors.js";
export { type GuardInput, guardRedirect } from "./auth/guard.js";
export {
  type AuthAction,
  AuthProvider,
  useAddPasskey,
  useAuthClient,
  useChangePassword,
  useCurrentUser,
  useForgotPassword,
  useMagicLink,
  usePasskeySignIn,
  useResetPassword,
  useSignIn,
  useSignOut,
  useSignUp,
} from "./auth/hooks.js";
export { safeReturnUrl } from "./auth/return-url.js";
export {
  ChangePasswordSchema,
  type ChangePasswordValues,
  ForgotPasswordSchema,
  type ForgotPasswordValues,
  MagicLinkSchema,
  type MagicLinkValues,
  ResetPasswordSchema,
  type ResetPasswordValues,
  SignInSchema,
  type SignInValues,
  SignUpSchema,
  type SignUpValues,
} from "./auth/schemas.js";
