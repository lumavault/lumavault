import { createContextKey } from "@connectrpc/connect";

// The raw HTTP request behind each RPC, so handlers and guards can read session headers.
export const requestKey = createContextKey<Request | undefined>(undefined, { description: "http request" });
