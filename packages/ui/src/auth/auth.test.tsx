import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LumaVaultAuthClient } from "./client.js";
import { authErrorMessage } from "./errors.js";
import { guardRedirect } from "./guard.js";
import { AuthProvider, useSignIn, useSignUp } from "./hooks.js";
import { safeReturnUrl } from "./return-url.js";
import { SignUpSchema } from "./schemas.js";

const PORTAL = "https://portal.example.com";
const ORIGINS = [PORTAL, "https://photos.example.com", "https://cinema.example.com", "https://arcade.example.com"];

describe("safeReturnUrl", () => {
  it("keeps LumaVault URLs and Portal paths", () => {
    expect(safeReturnUrl("https://photos.example.com/albums/1?x=2", ORIGINS, PORTAL)).toBe("https://photos.example.com/albums/1?x=2");
    expect(safeReturnUrl("/household", ORIGINS, PORTAL)).toBe(`${PORTAL}/household`);
  });

  it("rejects outside domains, protocol-relative URLs, and non-HTTP schemes", () => {
    for (const bad of [
      "https://evil.example.com/",
      "https://photos.example.com.evil.com/",
      "//evil.example.com",
      "/\\evil.example.com",
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://photos.example.com/",
      "http://photos.example.com/",
    ]) {
      expect(safeReturnUrl(bad, ORIGINS, PORTAL), bad).toBe(PORTAL);
    }
    expect(safeReturnUrl(null, ORIGINS, PORTAL)).toBe(PORTAL);
  });
});

describe("guardRedirect", () => {
  const base = { portalUrl: PORTAL, currentUrl: "https://photos.example.com/albums/1" };

  it("sends signed-out visitors to Portal login with a way back", () => {
    const to = new URL(guardRedirect({ ...base, signedIn: false, householdCount: 0 })!);
    expect(to.origin + to.pathname).toBe(`${PORTAL}/login`);
    expect(to.searchParams.get("returnTo")).toBe(base.currentUrl);
  });

  it("lets guests with no household through only where allowed", () => {
    expect(guardRedirect({ ...base, signedIn: true, householdCount: 0 })).toBe(`${PORTAL}/`);
    expect(guardRedirect({ ...base, signedIn: true, householdCount: 0, allowGuests: true })).toBeNull();
    expect(guardRedirect({ ...base, signedIn: true, householdCount: 2 })).toBeNull();
  });
});

describe("authErrorMessage", () => {
  it("maps statuses to plain messages and keeps a blocked reason", () => {
    expect(authErrorMessage({ status: 401 })).toBe("Wrong email or password.");
    expect(authErrorMessage({ status: 400 })).toMatch(/fields/);
    expect(authErrorMessage({ status: 403, message: "sign-up is by invite only" })).toBe("sign-up is by invite only");
    expect(authErrorMessage({ status: 500 })).toMatch(/Something went wrong/);
    expect(authErrorMessage(null)).toBeNull();
  });
});

describe("schemas", () => {
  it("require matching passwords of at least 8 characters", () => {
    expect(SignUpSchema.safeParse({ name: "A", email: "a@b.co", password: "short", confirmPassword: "short" }).success).toBe(false);
    expect(SignUpSchema.safeParse({ name: "A", email: "a@b.co", password: "longenough", confirmPassword: "different" }).success).toBe(false);
    expect(SignUpSchema.safeParse({ name: "A", email: "a@b.co", password: "longenough", confirmPassword: "longenough" }).success).toBe(true);
  });
});

describe("hooks", () => {
  function withClient(fake: Partial<Record<string, unknown>>) {
    const client = fake as unknown as LumaVaultAuthClient;
    return ({ children }: { children: ReactNode }) => <AuthProvider client={client}>{children}</AuthProvider>;
  }

  it("report loading while a call runs, then a mapped error", async () => {
    let finish!: (v: unknown) => void;
    const email = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useSignIn(), { wrapper: withClient({ signIn: { email } }) });

    let done!: Promise<boolean>;
    act(() => {
      done = result.current.run({ email: "a@b.co", password: "nope" });
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      finish({ error: { status: 401, message: "Invalid" } });
      expect(await done).toBe(false);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Wrong email or password.");
  });

  it("sign up with name, email, and password only", async () => {
    const email = vi.fn(async () => ({ data: {}, error: null }));
    const { result } = renderHook(() => useSignUp(), { wrapper: withClient({ signUp: { email } }) });
    await act(async () => {
      expect(await result.current.run({ name: "A", email: "a@b.co", password: "longenough", confirmPassword: "longenough" })).toBe(true);
    });
    expect(email).toHaveBeenCalledWith({ name: "A", email: "a@b.co", password: "longenough" });
    expect(result.current.error).toBeNull();
  });

  it("turn a thrown network error into a message", async () => {
    const email = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const { result } = renderHook(() => useSignIn(), { wrapper: withClient({ signIn: { email } }) });
    await act(async () => {
      await result.current.run({ email: "a@b.co", password: "x" });
    });
    expect(result.current.error).toMatch(/Something went wrong/);
  });
});
