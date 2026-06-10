import { test, expect } from "@playwright/test";
import { installApiMock } from "./_helpers/mock-api";

/**
 * Smoke E2E: the app boots, the dashboard renders behind a mocked auth session,
 * and the core "create a project → land in the IDE" flow works end to end in a
 * real browser. All `/api/*` is mocked so this is deterministic and offline.
 */
test.describe("smoke", () => {
  test("dashboard loads with a mocked session", async ({ page }) => {
    await installApiMock(page, { projects: [{ id: "p1", name: "Existing Project" }] });
    await page.goto("/app");

    // The new-project entry point must be present (dashboard rendered).
    const newBtn = page.getByTestId("button-new-project").or(page.getByTestId("button-new-project-empty"));
    await expect(newBtn.first()).toBeVisible();
    // The seeded project should be listed.
    await expect(page.getByText("Existing Project")).toBeVisible();
  });

  test("redirects to /login when unauthenticated", async ({ page }) => {
    await installApiMock(page, { user: null });
    await page.goto("/app");
    await page.waitForURL("**/login", { timeout: 15_000 });
    expect(page.url()).toContain("/login");
  });

  test("create a project from the dashboard lands in the IDE", async ({ page }) => {
    await installApiMock(page);
    await page.goto("/app");

    await page.getByTestId("button-new-project").or(page.getByTestId("button-new-project-empty")).first().click();

    const dialog = page.getByTestId("dialog-new-project");
    await expect(dialog).toBeVisible();

    await page.getByTestId("input-project-idea").fill("a simple calculator app");
    await page.getByTestId("button-create-project").click();

    // Navigation into the IDE route.
    await page.waitForURL("**/project/**", { timeout: 15_000 });
    expect(page.url()).toMatch(/\/project\//);
  });
});
