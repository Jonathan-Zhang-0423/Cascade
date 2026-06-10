import { test, expect } from "@playwright/test";
import { installApiMock, openProjectViaDashboard, gotoDashboard } from "./_helpers/mock-api";

/**
 * Rapid-interaction E2E. An impatient user mashing the UI: double-clicking
 * buttons, opening/closing dialogs fast, typing then immediately sending,
 * toggling modes repeatedly. The UI must stay coherent — no duplicate
 * navigation, no stuck dialogs, no crash.
 */
test.describe("rapid interaction", () => {
  test("double-submitting create-project does not double-navigate", async ({ page }) => {
    await installApiMock(page);
    await gotoDashboard(page);

    await page.getByTestId("button-new-project").or(page.getByTestId("button-new-project-empty")).first().click();
    await expect(page.getByTestId("dialog-new-project")).toBeVisible();

    await page.getByTestId("input-project-idea").fill("rapid app");
    const createBtn = page.getByTestId("button-create-project");
    // Double-submit the create in quick succession; the second click races the
    // navigation, so bound it and ignore if the element is already gone.
    await createBtn.click();
    await createBtn.click({ force: true, timeout: 600 }).catch(() => {});

    await page.waitForURL("**/project/**", { timeout: 15_000 });
    // Landed in exactly one IDE (single URL, chat present, no stuck dialog).
    await expect(page.getByTestId("input-chat")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dialog-new-project")).toHaveCount(0);
  });

  test("rapidly toggling plan/build mode leaves a consistent state", async ({ page }) => {
    await installApiMock(page, { projects: [{ id: "toggle-proj", name: "Toggle Project" }] });
    await openProjectViaDashboard(page, "toggle-proj");
    await expect(page.getByTestId("input-chat")).toBeVisible({ timeout: 20_000 });

    const toggle = page.getByTestId("toggle-plan-mode");
    await toggle.waitFor({ state: "visible" });
    // Flip it many times fast.
    for (let i = 0; i < 8; i++) await toggle.click();

    // The toggle is still present and interactive (didn't crash the panel).
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("input-chat")).toBeVisible();
  });

  test("fast type-and-send several messages without losing the input box", async ({ page }) => {
    await installApiMock(page, {
      projects: [{ id: "spam-proj", name: "Spam Project" }],
      manager: { narration: "noted", planSteps: [{ step: 1, title: "S", description: "d" }] },
    });
    await openProjectViaDashboard(page, "spam-proj");
    const chatInput = page.getByTestId("input-chat");
    await expect(chatInput).toBeVisible({ timeout: 20_000 });

    // Build mode (default): fire several messages quickly. The input must remain
    // usable and the app must not crash between rapid sends.
    for (let i = 0; i < 5; i++) {
      await chatInput.fill(`message number ${i}`);
      await page.getByTestId("button-send-chat").click().catch(() => {});
      await page.waitForTimeout(150);
    }
    // Input box survives the burst and is editable again.
    await expect(chatInput).toBeVisible();
    await chatInput.fill("final check");
    await expect(chatInput).toHaveValue("final check");
  });

  test("opening and cancelling the new-project dialog repeatedly is clean", async ({ page }) => {
    await installApiMock(page);
    await gotoDashboard(page);
    const newBtn = page.getByTestId("button-new-project").or(page.getByTestId("button-new-project-empty")).first();

    for (let i = 0; i < 5; i++) {
      await newBtn.click();
      await expect(page.getByTestId("dialog-new-project")).toBeVisible();
      await page.getByTestId("button-cancel-new").click();
      await expect(page.getByTestId("dialog-new-project")).toHaveCount(0);
    }
    // Still functional after the churn.
    await newBtn.click();
    await expect(page.getByTestId("dialog-new-project")).toBeVisible();
  });
});
