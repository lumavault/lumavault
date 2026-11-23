import { Code, ConnectError } from "@connectrpc/connect";

/** Maps a failed data plane response onto the same Connect codes the RPCs use. */
export async function dataPlaneError(res: Response): Promise<ConnectError> {
  return new ConnectError(await errorMessage(res), codeForStatus(res.status));
}

export function codeForStatus(status: number): Code {
  switch (status) {
    case 400:
    case 413:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 416:
      return Code.OutOfRange;
    case 500:
      return Code.Internal;
    default:
      return status >= 500 ? Code.Unavailable : Code.Unknown;
  }
}

/** Wraps a fetch failure such as a dropped connection. Aborts keep their own code. */
export function networkError(cause: unknown): ConnectError {
  if (cause instanceof ConnectError) {
    return cause;
  }
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new ConnectError("request aborted", Code.Canceled, undefined, undefined, cause);
  }
  return new ConnectError("network request failed", Code.Unavailable, undefined, undefined, cause);
}

export function hashMismatch(what: string): ConnectError {
  return new ConnectError(`${what} does not match its SHA-256`, Code.DataLoss);
}

// The gateway sends {"error": msg}; fall back to the status text for anything else.
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Not JSON, use the status line below.
  }
  return `HTTP ${res.status} ${res.statusText}`.trim();
}
