import { expect, test, type Page } from "@playwright/test";

// The admin test needs an email the API treats as an admin (one of its ADMIN_EMAILS):
//   ADMIN_EMAILS=e2e-admin@test.dev make api   and   E2E_ADMIN_EMAIL=e2e-admin@test.dev make e2e
const ADMIN = process.env.E2E_ADMIN_EMAIL;
const API = (process.env.E2E_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

test("admin is for admins only", async ({ page }, info) => {
  await signIn(page, `e2e-nosy-${info.project.name}-${Date.now()}@test.dev`);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("admin: usage overview and people, without project contents", async ({ page, request }, info) => {
  test.skip(!ADMIN, "Set E2E_ADMIN_EMAIL to an email in the API's ADMIN_EMAILS");
  const maker = `e2e-maker-${info.project.name}-${Date.now()}@test.dev`;
  const secret = `Secret walnut credenza ${Date.now()}`;
  const r = await request.post(`${API}/api/projects`, { headers: { Authorization: `Bearer dev:${maker}` }, data: { name: secret } });
  expect(r.ok()).toBeTruthy();

  await signIn(page, ADMIN!);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active people" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI calls" })).toBeVisible();
  await page.getByRole("tab", { name: "90 days" }).click();
  await expect(page.getByRole("tab", { name: "90 days" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: /^People/ }).click();
  await page.getByLabel("Search people").fill(maker);
  if (info.project.name === "phone") await page.getByRole("button", { name: maker }).click();
  else await page.getByRole("row").filter({ hasText: maker }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Time in app" })).toBeVisible();
  await expect(sheet.getByText("Projects", { exact: true }).first()).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Make admin" })).toBeVisible();
  await expect(page.getByText(secret)).toHaveCount(0);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
});
