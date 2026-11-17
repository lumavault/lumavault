import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { API_URL } from "./env";
import { linkFromEmail, mailCount } from "./mailbox";

const OWNER = { name: "Ada Owner", email: "ada@e2e.test", password: "owner password 1" };
const BOB = { name: "Bob Member", email: "bob@e2e.test", password: "member password 1" };
const CAROL = { name: "Carol Guest", email: "carol@e2e.test", password: "guest password 1" };

async function rpc<T>(method: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/rpc/lumavault.iam.v1.IamService/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  expect(res.status, `${method} failed: ${await res.clone().text()}`).toBe(200);
  return (await res.json()) as T;
}

async function signUp(page: Page, person: typeof BOB) {
  await page.getByLabel("Name", { exact: true }).fill(person.name);
  await page.getByLabel("Email", { exact: true }).fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByLabel("Confirm password").fill(person.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function signInWithPassword(page: Page, person: typeof BOB) {
  await page.goto("/login");
  await page.locator("#email").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Apps" })).toBeVisible();
}

async function fresh(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.describe.serial("Portal against the real API", () => {
  let owner: Page;

  test.beforeAll(async ({ browser }) => {
    owner = (await fresh(browser)).page;
  });

  test("first-run setup creates the owner and their household", async () => {
    await owner.goto("/");
    await expect(owner).toHaveURL(/\/setup$/);
    await owner.getByLabel("Your name").fill(OWNER.name);
    await owner.getByLabel("Email").fill(OWNER.email);
    await owner.getByLabel("Password", { exact: true }).fill(OWNER.password);
    await owner.getByLabel("Confirm password").fill(OWNER.password);
    await owner.getByLabel("Household name").fill("Owner Home");
    await owner.getByRole("button", { name: "Create owner account" }).click();
    await expect(owner.getByRole("heading", { name: "Apps" })).toBeVisible();
    await expect(owner.getByText("Owner Home")).toBeVisible();
    await expect(owner.getByRole("link", { name: "Server admin" })).toBeVisible();
  });

  test("an Admin invites a member who signs up and joins", async ({ browser }) => {
    await owner.goto("/household");
    const before = await mailCount();
    await owner.getByLabel("Email").fill(BOB.email);
    await owner.getByRole("button", { name: "Send invite" }).click();
    await expect(owner.getByRole("textbox", { name: "Invite link", exact: true })).toHaveValue(/\/invite\/member\//);

    const link = await linkFromEmail(BOB.email, /\/invite\/member\//, before);
    const { page: bob, context } = await fresh(browser);
    await bob.goto(link);
    await signUp(bob, BOB);
    await bob.getByRole("button", { name: "Accept invite" }).click();
    await expect(bob.getByRole("heading", { name: "Apps" })).toBeVisible();
    await expect(bob.getByText("Owner Home")).toBeVisible();
    await context.close();

    await owner.reload();
    await expect(owner.getByRole("row", { name: /Bob Member/ })).toBeVisible();
  });

  test("the Super-Admin invites a new household, which its owner redeems", async ({ browser }) => {
    await owner.goto("/admin");
    await owner.getByRole("tab", { name: "Invites" }).click();
    await owner.getByLabel("Who is it for?").fill("Carol");
    await owner.getByRole("button", { name: "Create invite link" }).click();
    const link = await owner.getByRole("textbox", { name: "Invite link", exact: true }).inputValue();

    const { page: carol, context } = await fresh(browser);
    await carol.goto(link);
    await signUp(carol, CAROL);
    await carol.getByLabel("Household name").fill("Carol's Place");
    await carol.getByRole("button", { name: "Create household" }).click();
    await expect(carol.getByRole("heading", { name: "Apps" })).toBeVisible();
    await expect(carol.getByText("Carol's Place")).toBeVisible();
    await context.close();

    await owner.getByRole("tab", { name: "Households" }).click();
    await expect(owner.getByRole("row", { name: /Carol's Place/ })).toBeVisible();
  });

  test("password and magic-link sign-in", async ({ browser }) => {
    const pw = await fresh(browser);
    await signInWithPassword(pw.page, OWNER);
    await pw.context.close();

    const { page, context } = await fresh(browser);
    await page.goto("/login");
    const before = await mailCount();
    await page.locator("#magic-link-email").fill(BOB.email);
    await page.getByRole("button", { name: /sign-in link/ }).click();
    await expect(page.getByText(`Check ${BOB.email}`)).toBeVisible();
    await page.goto(await linkFromEmail(BOB.email, /magic-link\/verify/, before));
    await expect(page.getByRole("heading", { name: "Apps" })).toBeVisible();
    await expect(page.getByText(BOB.email).first()).toBeVisible();
    await context.close();
  });

  test("passkey sign-in with a virtual authenticator", async ({ browser }) => {
    const { page, context } = await fresh(browser);
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
    });

    await signInWithPassword(page, OWNER);
    await page.goto("/account");
    await page.getByLabel("Name this device").fill("Test authenticator");
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByText("Passkey added.")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole("button", { name: /passkey/ }).click();
    await expect(page.getByRole("heading", { name: "Apps" })).toBeVisible();
    await context.close();
  });

  test("Apple TV pairing hands the TV a session once", async () => {
    const start = await rpc<{ pairingId: string; code: string; deviceSecret: string }>("StartPairing", { deviceName: "Living Room" });
    await owner.goto("/pair");
    await owner.getByLabel("Code").pressSequentially(start.code.toLowerCase());
    await owner.getByRole("button", { name: "Approve" }).click();
    await expect(owner.getByText("Living Room is signed in")).toBeVisible();

    const poll = () => rpc<{ status?: string; sessionToken?: string }>("PollPairing", { pairingId: start.pairingId, deviceSecret: start.deviceSecret });
    const first = await poll();
    expect(first.status).toBe("PAIRING_STATUS_APPROVED");
    const viewer = await rpc<{ user: { email: string } }>("GetViewer", {}, first.sessionToken);
    expect(viewer.user.email).toBe(OWNER.email);
    expect((await poll()).status).toBe("PAIRING_STATUS_EXPIRED");
  });
});
