import { expect, test, type Page } from "@playwright/test";

// Switching to Hebrew needs an admin while the interface is being translated (see admin.spec.ts).
const ADMIN = process.env.E2E_ADMIN_EMAIL;

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

test("the Hebrew interface stays hidden from everyone but admins", async ({ page }, info) => {
  await signIn(page, `e2e-lang-${info.project.name}-${Date.now()}@test.dev`);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Language", exact: true })).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl");
});

test("Hebrew: right to left from the first paint, and back to English", async ({ page }) => {
  test.skip(!ADMIN, "Set E2E_ADMIN_EMAIL to an email in the API's ADMIN_EMAILS");
  await signIn(page, ADMIN!);
  await page.goto("/settings");
  await page.getByRole("tablist", { name: "Language", exact: true }).getByRole("tab", { name: "עברית" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
  await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();

  await page.getByRole("tablist", { name: "שפה" }).getByRole("tab", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
