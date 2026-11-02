import { expect, test, type Page } from "@playwright/test";
import { he } from "../src/messages";

const API = (process.env.E2E_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

test("anyone can switch language from the account menu", async ({ page }, info) => {
  await signIn(page, `e2e-lang-${info.project.name}-${Date.now()}@test.dev`);
  await page.getByRole("button", { name: "Account" }).click();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/me") && r.request().method() === "PUT");
  await page.getByRole("menuitem", { name: "עברית" }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: he.home.title })).toBeVisible();

  // Saved to the account: Settings shows it, and it outlasts a reload.
  await page.goto("/settings");
  await expect(page.getByRole("tablist", { name: he.settings.language, exact: true }).getByRole("tab", { name: "עברית" })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByRole("button", { name: he.nav.account }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
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
