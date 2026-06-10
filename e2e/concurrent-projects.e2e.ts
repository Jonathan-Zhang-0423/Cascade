import { test, expect } from "@playwright/test";
import { installApiMock, gotoDashboard, backToDashboard } from "./_helpers/mock-api";

/**
 * Concurrent projects E2E. A user juggling several projects in one session:
 * create multiple projects, confirm they all appear, switch between them, and
 * delete one without disturbing the others. Exercises the dashboard list and
 * client-side routing under repeated create/navigate/delete.
 */
test.describe("concurrent projects", () => {
  test("create several projects and see them all listed", async ({ page }) => {
    await installApiMock(page);
    await gotoDashboard(page);

    const ideas = ["calculator app", "todo list", "weather widget"];
    for (let i = 0; i < ideas.length; i++) {
      if (i > 0) await backToDashboard(page); // return from the previous IDE via in-app nav
      await page.getByTestId("button-new-project").or(page.getByTestId("button-new-project-empty")).first().click();
      await expect(page.getByTestId("dialog-new-project")).toBeVisible();
      await page.getByTestId("input-project-idea").fill(ideas[i]);
      await page.getByTestId("button-create-project").click();
      await page.waitForURL("**/project/**", { timeout: 15_000 });
    }

    // Back on the dashboard, all three should be present.
    await backToDashboard(page);
    await expect(page.getByTestId("project-list")).toBeVisible();
    const cards = page.locator('[data-testid^="card-project-"]');
    await expect(cards).toHaveCount(3, { timeout: 10_000 });
  });

  test("switching between two open projects keeps each one's route", async ({ page }) => {
    await installApiMock(page, {
      projects: [
        { id: "proj-a", name: "Project A" },
        { id: "proj-b", name: "Project B" },
      ],
    });
    await gotoDashboard(page);
    await page.getByTestId("card-project-proj-a").waitFor({ state: "visible", timeout: 20_000 });

    await page.getByTestId("card-project-proj-a").click();
    await page.waitForURL("**/project/proj-a");
    await expect(page.getByTestId("input-chat")).toBeVisible({ timeout: 20_000 });

    // Back to dashboard via in-app nav, open the other one.
    await backToDashboard(page);
    await page.getByTestId("card-project-proj-b").click();
    await page.waitForURL("**/project/proj-b");
    await expect(page.getByTestId("input-chat")).toBeVisible({ timeout: 20_000 });
  });

  test("deleting one project leaves the others intact", async ({ page }) => {
    await installApiMock(page, {
      projects: [
        { id: "keep-1", name: "Keep One" },
        { id: "del-me", name: "Delete Me" },
        { id: "keep-2", name: "Keep Two" },
      ],
    });
    await gotoDashboard(page);
    await expect(page.locator('[data-testid^="card-project-"]')).toHaveCount(3, { timeout: 20_000 });

    // Hover the card to reveal its delete control, then confirm in the dialog.
    const card = page.getByTestId("card-project-del-me");
    await card.hover();
    await page.getByTestId("button-delete-del-me").click();

    const dialog = page.getByTestId("dialog-delete-project");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("button-confirm-delete").click();

    // Two cards remain.
    await expect(page.locator('[data-testid^="card-project-"]')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByText("Delete Me")).toHaveCount(0);
  });
});
