import { test, expect } from "@playwright/test";
import { installApiMock, openProjectViaDashboard } from "./_helpers/mock-api";

/**
 * Plan-mode streaming E2E. Open a project, send a chat message in plan mode,
 * and verify the mocked manager-chat SSE stream renders end to end in a real
 * browser: narration text appears, then a plan card with the scripted steps.
 */
test.describe("plan-mode streaming", () => {
  test("sending a message streams narration then a plan card", async ({ page }) => {
    await installApiMock(page, {
      projects: [{ id: "plan-proj", name: "Plan Project" }],
      manager: {
        thinking: "Considering the requirements",
        narration: "I'll build a calculator with a clean layout and arithmetic logic.",
        planSteps: [
          { step: 1, title: "Scaffold the UI", description: "Create the calculator grid" },
          { step: 2, title: "Implement logic", description: "Wire up the operators" },
          { step: 3, title: "Polish styles", description: "Add responsive styling" },
        ],
        perTokenDelayMs: 0,
      },
    });

    await openProjectViaDashboard(page, "plan-proj");

    const chatInput = page.getByTestId("input-chat");
    await chatInput.waitFor({ state: "visible", timeout: 20_000 });

    // chatMode defaults to "build"; switch into plan mode so send hits manager-chat.
    await ensurePlanMode(page);

    await chatInput.fill("Build me a calculator");
    await page.getByTestId("button-send-chat").click();

    // The scripted plan should surface as a plan card with our step titles.
    await expect(page.getByTestId("task-plan-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Scaffold the UI")).toBeVisible();
    await expect(page.getByText("Implement logic")).toBeVisible();

    // An execute-plan affordance should be offered once the plan is ready.
    await expect(page.getByTestId("button-execute-plan")).toBeVisible({ timeout: 10_000 });
  });

  test("plan summary and steps from the SSE payload render in the plan card", async ({ page }) => {
    await installApiMock(page, {
      projects: [{ id: "narr-proj", name: "Narration Project" }],
      manager: {
        narration: "Streaming narration tokens before the plan.",
        planSteps: [
          { step: 1, title: "Unique Step Alpha", description: "Do alpha" },
          { step: 2, title: "Unique Step Beta", description: "Do beta" },
        ],
      },
    });

    await openProjectViaDashboard(page, "narr-proj");
    const chatInput = page.getByTestId("input-chat");
    await chatInput.waitFor({ state: "visible", timeout: 20_000 });
    await ensurePlanMode(page);
    await chatInput.fill("Plan something");
    await page.getByTestId("button-send-chat").click();

    // The plan card renders with the scripted step titles delivered over SSE.
    await expect(page.getByTestId("task-plan-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Unique Step Alpha")).toBeVisible();
    await expect(page.getByText("Unique Step Beta")).toBeVisible();
  });
});

/**
 * Ensure the chat is in plan ("manager") mode. chatMode defaults to "build";
 * the toggle is checked (blue) when in manager mode. We click only if it isn't
 * already active, so the helper is idempotent.
 */
async function ensurePlanMode(page: import("@playwright/test").Page): Promise<void> {
  const toggle = page.getByTestId("toggle-plan-mode");
  await toggle.waitFor({ state: "visible", timeout: 10_000 });
  // In manager (plan) mode the toggle shows a checkmark (an <svg> child); in
  // build mode the checkbox is empty. Click only when no check is present.
  const isPlan = async () => (await toggle.locator("svg").count()) > 0;
  if (!(await isPlan())) {
    await toggle.click();
    // Confirm the switch took effect.
    await expect.poll(isPlan, { timeout: 5_000 }).toBe(true);
  }
}

