import { test, expect } from "@playwright/test";
import { installApiMock, openProjectViaDashboard, backToDashboard } from "./_helpers/mock-api";

/**
 * Reconnect / resilience E2E. A real user's network is flaky: tabs reload, the
 * IDE is re-entered, the page is refreshed mid-session. The app must recover
 * gracefully — re-hydrate the project, keep the chat usable, and never get
 * stuck on a blank or /login screen.
 *
 * Streams are mocked to terminate cleanly, and the manager status/stream
 * reconnect endpoints report "done", so the client settles rather than hanging.
 */
test.describe("reconnect & resilience", () => {
  test("reloading the IDE page re-hydrates the project and chat", async ({ page }) => {
    await installApiMock(page, { projects: [{ id: "reload-proj", name: "Reload Project" }] });
    await openProjectViaDashboard(page, "reload-proj");
    await expect(page.getByTestId("input-chat")).toBeVisible({ timeout: 20_000 });

    // Hard reload directly on the IDE route. The project store persists to
    // localStorage, and /api/auth/me is mocked, so the IDE must come back.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-chat")).toBeVisible({ timeout: 20_000 });
    expect(page.url()).toContain("/project/reload-proj");
  });

  test("re-entering a project after leaving keeps it usable", async ({ page }) => {
    await installApiMock(page, {
      projects: [{ id: "re-enter", name: "Re-enter Project" }],
      manager: { narration: "ok", planSteps: [{ step: 1, title: "Step One", description: "d" }] },
    });
    await openProjectViaDashboard(page, "re-enter");
    await expect(page.getByTestId("input-chat")).toBeVisible({ timeout: 20_000 });

    // Leave to the dashboard and come back in.
    await backToDashboard(page);
    await page.getByTestId("card-project-re-enter").click();
    await page.waitForURL("**/project/re-enter");
    const chatInput = page.getByTestId("input-chat");
    await expect(chatInput).toBeVisible({ timeout: 20_000 });

    // Chat still works after re-entry.
    await chatInput.fill("still working?");
    await expect(chatInput).toHaveValue("still working?");
  });

  test("an interrupted manager stream settles via the reconnect endpoints", async ({ page }) => {
    // The mock's /status returns done and /stream returns [DONE], so even if the
    // client attempts a reconnect after a dropped POST stream, it converges.
    await installApiMock(page, {
      projects: [{ id: "interrupt", name: "Interrupt Project" }],
      manager: {
        narration: "partial narration",
        planSteps: [{ step: 1, title: "Recoverable Step", description: "d" }],
      },
    });
    await openProjectViaDashboard(page, "interrupt");
    const chatInput = page.getByTestId("input-chat");
    await expect(chatInput).toBeVisible({ timeout: 20_000 });

    // Switch to plan mode and send.
    const toggle = page.getByTestId("toggle-plan-mode");
    if ((await toggle.locator("svg").count()) === 0) await toggle.click();
    await chatInput.fill("make a plan");
    await page.getByTestId("button-send-chat").click();

    // Plan arrives; then reload mid/post-stream — the app must not wedge.
    await expect(page.getByTestId("task-plan-card")).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-chat")).toBeVisible({ timeout: 20_000 });
    // Not bounced to /login or a blank page.
    expect(page.url()).toContain("/project/interrupt");
  });
});
