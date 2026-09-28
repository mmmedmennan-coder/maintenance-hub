import { type Page, expect } from "@playwright/test";

export const BASE_URL = "http://localhost:3100";
export const PASSWORD = "Demo-Pilote-2026";
export const demo = (local: string) => `${local}@demo.maintenance-hub.test`;
const MAILPIT = "http://127.0.0.1:8025";

/** Signs in through the auth API (the sign-in form itself is covered by the sign-up journey). */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email, password }, headers: { Origin: BASE_URL } });
  expect(res.ok(), `sign-in ${email}: ${res.status()}`).toBeTruthy();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

/** Local date (Africa/Casablanca) `days` ahead, moved forward past Sundays (technicians work Mon–Sat). */
export function workday(days: number) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" });
  let d = new Date(Date.now() + days * 86_400_000);
  while (new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Casablanca", weekday: "short" }).format(d) === "Sun") d = new Date(d.getTime() + 86_400_000);
  return fmt.format(d);
}

/** Waits for an e-mail captured by Mailpit and returns the first link matching `pattern`. */
export async function linkFromMail(to: string, pattern: RegExp, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((r) => r.json());
    for (const m of search.messages ?? []) {
      const msg = await fetch(`${MAILPIT}/api/v1/message/${m.ID}`).then((r) => r.json());
      const found = String(msg.Text ?? "").match(pattern);
      if (found) return found[0];
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No e-mail to ${to} matching ${pattern}`);
}

export async function confirmDialog(page: Page, name: string | RegExp) {
  await page.getByRole("dialog").getByRole("button", { name }).click();
}
