import { expect } from "@playwright/test";
import { MAILBOX_URL } from "./env";

interface Mail {
  to: string[];
  raw: string;
}

// Emails arrive quoted-printable; undo soft line breaks and escapes so links read whole.
function decode(raw: string): string {
  return raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Waits for the newest email to address and returns the first link in it that matches pattern. */
export async function linkFromEmail(address: string, pattern: RegExp, after = 0): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const mails = (await (await fetch(MAILBOX_URL)).json()) as Mail[];
      const mine = mails.slice(after).filter((m) => m.to.includes(address));
      const text = mine.length ? decode(mine.at(-1)!.raw) : "";
      link = text.match(new RegExp(`https?://[^\\s"'<>]*${pattern.source}[^\\s"'<>]*`))?.[0]?.replace(/&amp;/g, "&");
      return link;
    }, { timeout: 15_000 })
    .toBeTruthy();
  return link!;
}

export async function mailCount(): Promise<number> {
  return ((await (await fetch(MAILBOX_URL)).json()) as Mail[]).length;
}
