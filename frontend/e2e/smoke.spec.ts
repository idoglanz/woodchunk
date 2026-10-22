import { expect, test } from "@playwright/test";

test("plan a build from scratch: design → plan → buy", async ({ page }, info) => {
  const email = `e2e-${info.project.name}-${Date.now()}@test.dev`;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByRole("button", { name: "Blank" }).click();
  await page.getByLabel("Name").fill("E2E bench");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("E2E bench");

  await page.getByRole("button", { name: "Add assembly" }).first().click();
  await page.getByRole("button", { name: "Add part" }).click();
  await page.getByLabel("A1 name").fill("Leg");
  await page.getByLabel("A1 name").press("Enter");
  await page.getByRole("button", { name: "A1 material" }).click();
  await page.getByLabel("Search catalog").fill("44 100 rough");
  await page.getByLabel("Search catalog").press("Enter");
  await page.getByLabel("A1 quantity").fill("4");
  await page.getByLabel("A1 quantity").press("Enter");
  await page.getByLabel("A1 length").fill("75cm");
  await page.getByLabel("A1 length").press("Enter");
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByLabel("A1 length")).toHaveValue("750");

  await page.getByRole("tab", { name: "Plan" }).click();
  await expect(page.getByRole("heading", { name: "Lumber" })).toBeVisible();
  await expect(page.getByText("Optimal").first()).toBeVisible();

  await page.getByRole("tab", { name: "Buy" }).click();
  await expect(page.getByText("44 × 100 whitewood, rough").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark as bought" }).click();
  await expect(page.getByText(/Bought on/)).toBeVisible();
  await expect(page.getByText("Nothing more to buy")).toBeVisible();
});
