import { createContextKey } from "@connectrpc/connect";

// The raw HTTP request behind each RPC, so handlers and guards can read session headers.
export const requestKey = createContextKey<Request | undefined>(undefined, { description: "http request" });

// The caller's network address, for rate limits. "unknown" when the server cannot tell.
export const clientIpKey = createContextKey<string>("unknown", { description: "client ip" });
