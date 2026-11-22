// Keyset paging for list RPCs. The page token is the last row's sort key, so rows added while
// someone pages never shift or repeat later pages.
import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import type { PageCursor } from "#/data/sql.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

const cursorSchema = z.object({ c: z.iso.datetime(), i: z.string().min(1) });

/** The page size to use. Zero means the default, and anything above the maximum gets the maximum. */
export function pageSize(requested: number): number {
  if (requested < 0) {
    throw new ConnectError("page_size must not be negative", Code.InvalidArgument);
  }
  return requested === 0 ? DEFAULT_PAGE_SIZE : Math.min(requested, MAX_PAGE_SIZE);
}

export function encodePageToken(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })).toString("base64url");
}

/** The cursor a page token carries. Undefined for the first page. */
export function decodePageToken(token: string): PageCursor | undefined {
  if (!token) {
    return undefined;
  }
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
    return { createdAt: new Date(parsed.c), id: parsed.i };
  } catch {
    throw new ConnectError("page_token is not valid", Code.InvalidArgument);
  }
}

/** Loads one page, reading one extra row to learn whether another page follows. */
export async function paged<T>(
  request: { pageToken: string; pageSize: number },
  load: (after: PageCursor | undefined, limit: number) => Promise<T[]>,
  cursorOf: (row: T) => PageCursor,
): Promise<{ rows: T[]; nextPageToken: string }> {
  const size = pageSize(request.pageSize);
  const rows = await load(decodePageToken(request.pageToken), size + 1);
  if (rows.length <= size) {
    return { rows, nextPageToken: "" };
  }
  const kept = rows.slice(0, size);
  return { rows: kept, nextPageToken: encodePageToken(cursorOf(kept[kept.length - 1]!)) };
}
