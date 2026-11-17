/** The error shape Better Auth's client returns. */
export interface AuthErrorLike {
  status?: number;
  message?: string;
  code?: string;
}

/**
 * A plain message for a failed auth call, following the sweetbeasts forms: wrong fields,
 * wrong credentials, or blocked. A 403 keeps the server's own message, since it explains why
 * (for example, sign-up is by invite only).
 */
export function authErrorMessage(error: AuthErrorLike | null | undefined): string | null {
  if (!error) return null;
  switch (error.status) {
    case 400:
    case 422:
      return "Some fields are not right. Check them and try again.";
    case 401:
      return "Wrong email or password.";
    case 403:
      return error.message || "You are not allowed to do that.";
    case 429:
      return "Too many attempts. Wait a minute and try again.";
    default:
      return "Something went wrong. Try again.";
  }
}
