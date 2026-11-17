// Keyset paging for list RPCs. A page token is the last row's sort key, base64url-encoded,
// so clients treat it as opaque.
import { Code, ConnectError } from "@connectrpc/connect";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "#/iam/constants.js";

export function pageSize(requested: number): number {
  if (requested <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

export function encodePageToken(lastKey: string): string {
  return Buffer.from(lastKey, "utf8").toString("base64url");
}

/** The last key from a page token, or null for the first page. */
export function decodePageToken(token: string): string | null {
  if (!token) return null;
  const key = Buffer.from(token, "base64url").toString("utf8");
  if (!key || encodePageToken(key) !== token) {
    throw new ConnectError("invalid page_token", Code.InvalidArgument);
  }
  return key;
}
