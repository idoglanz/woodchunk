import { expect, test } from "@playwright/test";

test("plan a build from scratch: build → buy", async ({ page }, info) => {
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
  const qty = page.getByLabel("A1 quantity", { exact: true });
  await qty.fill("3");
  await qty.press("Enter");
  await page.getByRole("button", { name: "Increase A1 quantity" }).click();
  await expect(qty).toHaveValue("4");
  await page.getByLabel("A1 length").fill("75cm");
  await page.getByLabel("A1 length").press("Enter");
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByLabel("A1 length")).toHaveValue("750");

  // The cutting plan sits beside the parts on desktop and in a bottom drawer on phones.
  if (info.project.name === "phone") await page.getByRole("button", { name: "Show cutting plan" }).click();
  const plan = page.getByRole(info.project.name === "phone" ? "region" : "complementary", { name: "Cutting plan" });
  await expect(plan.getByRole("heading", { name: "Lumber" })).toBeVisible();
  await expect(plan.getByText("Optimal").first()).toBeVisible();
  if (info.project.name === "phone") await page.getByRole("button", { name: "Hide cutting plan" }).click();
  await qty.press("ArrowDown");
  await expect(qty).toHaveValue("3");
  await page.getByRole("button", { name: "Increase A1 quantity" }).click();
  await expect(qty).toHaveValue("4");

  await page.getByRole("tab", { name: "Buy" }).click();
  await expect(page.getByText("44 × 100 whitewood, rough").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark as bought" }).click();
  await expect(page.getByText(/Bought on/)).toBeVisible();
  await expect(page.getByText("Nothing more to buy")).toBeVisible();
});
