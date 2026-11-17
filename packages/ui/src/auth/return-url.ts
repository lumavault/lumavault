/**
 * Picks where to send someone after sign-in. Only absolute http(s) URLs on a known
 * LumaVault origin, or paths on the Portal, pass; anything else falls back. This stops a
 * crafted login link from bouncing people to another site.
 */
export function safeReturnUrl(raw: string | null | undefined, allowedOrigins: string[], fallback: string): string {
  if (!raw) return fallback;
  const value = raw.trim();
  // Protocol-relative and backslash tricks are refused before parsing, since browsers treat
  // //host and /\host as other sites.
  if (value.startsWith("//") || value.startsWith("/\\") || value.includes("\\")) return fallback;
  let url: URL;
  try {
    url = new URL(value, fallback);
  } catch {
    return fallback;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
  const allowed = new Set(allowedOrigins.map((o) => new URL(o).origin));
  return allowed.has(url.origin) ? url.toString() : fallback;
}
