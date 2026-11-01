import { expect, test, type Page } from "@playwright/test";
import { he } from "../src/messages";

// The switch shows for admins only while the interface is being translated (see admin.spec.ts).
// The admin test only looks: the admin account is shared, so its language is never changed here.
const ADMIN = process.env.E2E_ADMIN_EMAIL;
const API = (process.env.E2E_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

test("the language switch is for admins only, for now", async ({ page }, info) => {
  await signIn(page, `e2e-lang-${info.project.name}-${Date.now()}@test.dev`);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Language", exact: true })).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl");

  if (!ADMIN) return;
  await page.evaluate(() => localStorage.clear()); // signed out, or the sign-in page moves on by itself
  await signIn(page, ADMIN);
  await page.goto("/settings");
  await expect(page.getByRole("tablist", { name: "Language", exact: true }).getByRole("tab", { name: "עברית" })).toBeVisible();
});

test("Hebrew: right to left from the first paint, drawings left to right", async ({ page, request }, info) => {
  const email = `e2e-he-${info.project.name}-${Date.now()}@test.dev`;
  await signIn(page, email);
  const r = await request.put(`${API}/api/me`, { headers: { Authorization: `Bearer dev:${email}` }, data: { prefs: { lang: "he" } } });
  expect(r.ok()).toBeTruthy();

  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
  await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();
  // Remembered on the device: right to left before the account has loaded.
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");

  if (info.project.name !== "desktop") return;
  // In Hebrew from here on: the names come from the Hebrew messages.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: he.home.title })).toBeVisible();
  await page.getByRole("button", { name: he.home.newProject }).first().click();
  await page.getByRole("button", { name: he.home.blank }).click();
  await page.getByLabel(he.home.name).fill("E2E Hebrew");
  await page.getByRole("button", { name: he.common.create }).click();
  await page.getByRole("button", { name: he.sketch.card.newSketch }).click();
  await expect(page.getByRole("img", { name: he.sketch.canvas.aria }).locator("..")).toHaveAttribute("dir", "ltr");
  // A Hebrew keyboard: R types ר, and still picks the rectangle.
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ר", code: "KeyR" })));
  await expect(page.getByRole("radio", { name: he.sketch.tools.rect })).toHaveAttribute("aria-checked", "true");
});
