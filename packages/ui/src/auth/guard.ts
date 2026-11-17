import { PORTAL_HOME_PATH, PORTAL_LOGIN_PATH, RETURN_TO_PARAM } from "./constants.js";

export interface GuardInput {
  /** Whether a session exists. */
  signedIn: boolean;
  /** How many households the viewer belongs to. Zero for an outside contributor. */
  householdCount: number;
  /** Let signed-in viewers with no household through, for shared album pages. */
  allowGuests?: boolean;
  portalUrl: string;
  /** The page being opened, to come back to after sign-in. */
  currentUrl: string;
}

/**
 * Decides whether a signed-in page may open. Returns null to allow it, or the URL to send the
 * visitor to: Portal login when signed out, the Portal home when they have no household.
 */
export function guardRedirect(input: GuardInput): string | null {
  if (!input.signedIn) {
    const login = new URL(PORTAL_LOGIN_PATH, input.portalUrl);
    login.searchParams.set(RETURN_TO_PARAM, input.currentUrl);
    return login.toString();
  }
  if (input.householdCount === 0 && !input.allowGuests) {
    return new URL(PORTAL_HOME_PATH, input.portalUrl).toString();
  }
  return null;
}
