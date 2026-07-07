import { test, expect } from "@playwright/test";
import { installApiMock, openProjectViaDashboard } from "./_helpers/mock-api";

/**
 * Plan-card persistence E2E. The known failure class: a plan/build card that
 * renders during a session must survive a page refresh and a leave/return,
 * rather than reverting to a blank "start build" state. These lock the
 * rehydrate-from-persisted-messages path that ide-store.loadProject drives.
 */
test.describe("plan card persistence", () => {
  async function ensurePlanMode(page: import("@playwright/test").Page): Promise<void> {
    const toggle = page.getByTestId("toggle-plan-mode");
    await toggle.waitFor({ state: "visible", timeout: 10_000 });
    const checked = await toggle.locator("svg").count();
    if (checked === 0) await toggle.click();
  }

  async function generatePlan(page: import("@playwright/test").Page) {
    const chatInput = page.getByTestId("input-chat");
    await chatInput.waitFor({ state: "visible", timeout: 20_000 });
    await ensurePlanMode(page);
    await chatInput.fill("Build me a calculator");
    await page.getByTestId("button-send-chat").click();
    await expect(page.getByTestId("task-plan-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Persisted Step One")).toBeVisible();
  }

  test("a generated plan card survives a hard page refresh", async ({ page }) => {
    await installApiMock(page, {
      projects: [{ id: "persist-proj", name: "Persist Project" }],
      manager: {
        narration: "Here's the plan.",
        planSteps: [
          { step: 1, title: "Persisted Step One", description: "Do one" },
          { step: 2, title: "Persisted Step Two", description: "Do two" },
        ],
      },
    });

    await openProjectViaDashboard(page, "persist-proj");
    await generatePlan(page);

    // Hard reload — the plan card must re-hydrate from persisted manager
    // messages, not vanish back to an empty chat.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("task-plan-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Persisted Step One")).toBeVisible();
  });
});
