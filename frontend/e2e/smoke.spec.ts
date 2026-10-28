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

  // Phones switch views from the bottom tab bar; wider screens from the tabs at the top.
  await page.getByRole(info.project.name === "phone" ? "link" : "tab", { name: "Buy" }).click();
  await expect(page.getByText("50 × 100 whitewood, rough (44 × 100 net)").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark as bought" }).click();
  await expect(page.getByText(/Bought on/)).toBeVisible();
  await expect(page.getByText("Nothing more to buy")).toBeVisible();
});

test("design a frame in 3D: template → cut list → parameters → Build", async ({ page }, info) => {
  const email = `e2e-frame-${info.project.name}-${Date.now()}@test.dev`;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByRole("button", { name: "Blank" }).click();
  await page.getByLabel("Name").fill("E2E frame");
  await page.getByRole("button", { name: "Create" }).click();

  await page.getByRole("button", { name: "Draw a frame" }).click();
  await expect(page.getByRole("radio", { name: /Table/ })).toBeChecked();
  await page.getByRole("button", { name: "Create frame" }).click();
  await expect(page).toHaveURL(/\/frame\//);

  // Outside dimensions 1200 × 600 × 750 in 40 mm tube: aprons stop at the legs' inner faces.
  const cut = page.getByRole("complementary", { name: "Frame details" });
  await expect(cut.getByText("2 × 1120 mm")).toBeVisible();
  await expect(cut.getByText("4 × 750 mm")).toBeVisible();
  await expect(cut.getByText("2 × 520 mm")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();

  if (info.project.name === "desktop") {
    // Change the width on the model itself.
    await page.getByRole("button", { name: "Width 1200 mm, click to change" }).click();
    const onModel = page.locator('input[aria-label="Width"]').last();
    await onModel.fill("1500");
    await onModel.press("Enter");
    await expect(cut.getByText("2 × 1420 mm")).toBeVisible();

    // Draw a 500 mm bar on the floor: L, click, point the way, type the length, Enter.
    const box = (await page.locator("canvas").boundingBox())!;
    await page.keyboard.press("l");
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.82);
    await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.82);
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.84, { steps: 6 });
    await page.keyboard.type("500");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const row = cut.locator("li button", { hasText: "1 × 500 mm" });
    await expect(row).toBeVisible();

    // Select it from the cut list and delete it.
    await row.click();
    await page.keyboard.press("Delete");
    await expect(row).toHaveCount(0);

    // Front view: flat, with every bar's length on the drawing; typing one resizes the frame (W).
    await page.getByRole("tab", { name: "Front" }).click();
    await expect(page.getByText(/Drawing on front face/)).toBeVisible();
    await page.getByRole("button", { name: /^Apron length 1500 mm/ }).first().click();
    const len = page.getByLabel("Apron length", { exact: true });
    await len.fill("1300");
    await len.press("Enter");
    await expect(cut.getByText("2 × 1220 mm")).toBeVisible();
    await page.getByRole("button", { name: "Back to the 3D view" }).click();
    await expect(page.getByText(/Drawing on front face/)).toHaveCount(0);
  }
  const wide = info.project.name === "desktop" ? "1220" : "1120";

  await page.getByRole("link", { name: "Back to Build" }).click();
  await expect(page.getByText(`2 × ${wide} mm`).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit in 3D" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add part" })).toHaveCount(0);
  await expect(page.getByText("Saved")).toBeVisible();
});

test("sketch: draw roughly, pin sizes, read off the rest", async ({ page }, info) => {
  const email = `e2e-sketch-${info.project.name}-${Date.now()}@test.dev`;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByRole("button", { name: "Blank" }).click();
  await page.getByLabel("Name").fill("E2E sketch");
  await page.getByRole("button", { name: "Create" }).click();

  // From the project's New menu (Build's Sketches card has the same button).
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sketch" }).click();
  await expect(page).toHaveURL(/\/sketch\//);
  await expect(page.getByText("Empty: draw something to start.")).toBeVisible();

  if (info.project.name !== "desktop") {
    // Phones look and change numbers; drawing needs a bigger screen.
    await expect(page.getByText(/To draw, open the sketch on a larger screen/)).toBeVisible();
    await expect(page.getByRole("radio", { name: "Line" })).toHaveCount(0);
    return;
  }

  const box = (await page.getByRole("img", { name: "Sketch" }).boundingBox())!;
  const at = (x: number, y: number) => page.mouse.click(box.x + x, box.y + y);
  // A rough rectangle, and a diagonal corner to corner (the clicks snap to the corners).
  await page.getByRole("radio", { name: "Rectangle" }).click();
  await at(200, 420);
  await at(520, 220);
  await expect(page.getByText(/2 more dimensions or relations/)).toBeVisible();
  await page.getByRole("radio", { name: "Line" }).click();
  await at(201, 419);
  await at(519, 221);

  // Dimension the bottom, the left side and the diagonal (already decided: worked out).
  await page.getByRole("radio", { name: "Dimension" }).click();
  for (const [x, y] of [[360, 420], [200, 320], [360, 320]]) {
    await at(x, y);
    await page.keyboard.press("Enter");
    if (await page.getByLabel("Value").count()) await page.getByLabel("Value").press("Escape");
  }
  const dims = page.getByRole("region", { name: "Dimensions" });
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.ok() && (r.request().postData() ?? "").includes('"value":600'));
  for (const [name, value] of [["Line 1 length", "1200"], ["Line 4 length", "600"]]) {
    await dims.getByRole("button", { name: new RegExp(`^${name}:`) }).click();
    await dims.getByLabel("Value").fill(value);
    await dims.getByLabel("Value").press("Enter");
  }
  await expect(page.getByText("Fully defined: every size is pinned down.")).toBeVisible();
  const diagonal = dims.getByRole("button", { name: "Line 5 length: 1341.6 mm, worked out" });
  await expect(diagonal).toBeVisible();

  // Saved with the project.
  await saved;
  await page.reload();
  await expect(diagonal).toBeVisible();
  // A rectangle typed from the origin is held in place: fully defined.
  await page.getByRole("link", { name: "Back to Build" }).click();
  await expect(page.getByText("Fully defined")).toBeVisible();
  await page.getByRole("button", { name: "New sketch" }).click();
  await page.getByRole("radio", { name: "Rectangle" }).click();
  const box2 = (await page.getByRole("img", { name: "Sketch" }).boundingBox())!;
  await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2); // the origin
  await page.mouse.move(box2.x + box2.width / 2 + 100, box2.y + box2.height / 2 - 100);
  await page.keyboard.type("1200x600");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Fully defined: every size is pinned down.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Dimensions" }).getByRole("button", { name: "Line 2 length: 600 mm" })).toBeVisible();

  // Keyboard: ? lists the shortcuts; a free line drawn, then Shift+H makes it level and an arrow nudges it.
  await page.keyboard.press("?");
  await expect(page.getByText("Nudge 1 mm (Shift: 10 mm)")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("l");
  await page.mouse.click(box2.x + 60, box2.y + 80);
  await page.mouse.click(box2.x + 260, box2.y + 60);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.mouse.click(box2.x + 160, box2.y + 70);
  await page.keyboard.press("Shift+H");
  await expect(page.getByRole("region", { name: "Relations" }).getByText("Line 5 horizontal")).toBeVisible();
});
