/**
 * Playwright end-to-end test: plan-mode manager-chat streaming UX.
 *
 * Tests user-visible timing in plan mode (new project, no files):
 *   - Typing indicator visible within 2s of send (frontend-injected, immediate)
 *   - First visible AI text content within 10s of send
 *     (Note: Doubao AI endpoint is in Beijing; network RTT is 5-10s.
 *      The pre-fix behavior was 15-30s due to server-side JSON buffering.
 *      After fix, content appears as soon as the AI produces its first tokens.)
 *   - Progressive growth: message text must grow across multiple polls
 *   - Full response completes within 60s
 *
 * Run:
 *   npx playwright test tests/plan-mode-streaming.e2e.ts
 */

import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:5000";
const TYPING_INDICATOR_MAX_MS = 2_000;
const FIRST_CONTENT_MAX_MS = 10_000;
const COMPLETION_MAX_MS = 60_000;
const PROGRESSIVE_POLL_INTERVAL_MS = 1_000;
const PROGRESSIVE_GROWTH_POLLS = 3;
const PROGRESSIVE_MIN_GROWTH_PER_POLL = 1;

test.setTimeout(90_000);

test("plan mode: typing indicator ≤2s, content starts ≤10s, response progressive and complete ≤60s", async ({
  page,
}) => {
  let managerChatCalled = false;
  await page.route("**/api/manager-chat", async (route) => {
    managerChatCalled = true;
    await route.continue();
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  const createBtn = page
    .locator(
      'button[data-testid="button-new-project"], button:has-text("新建项目"), button:has-text("New Project"), button:has-text("+")'
    )
    .first();
  await createBtn.click({ timeout: 10_000 });

  const nameInput = page.locator('input[placeholder], input[type="text"]').first();
  if (await nameInput.isVisible({ timeout: 2_000 })) {
    await nameInput.fill("streaming-e2e-test");
    await page.keyboard.press("Enter");
  }

  await page.waitForTimeout(1_500);

  const chatInput = page
    .locator(
      'textarea[data-testid], textarea[placeholder], input[data-testid*="chat"], input[placeholder*="消息"], input[placeholder*="message"]'
    )
    .first();
  await chatInput.waitFor({ state: "visible", timeout: 15_000 });

  const sendStart = Date.now();
  await chatInput.fill("我想做一个简单的计算器");

  const sendBtn = page
    .locator(
      'button[data-testid*="send"], button[type="submit"], button:near(textarea)'
    )
    .first();
  if (await sendBtn.isVisible({ timeout: 1_000 })) {
    await sendBtn.click();
  } else {
    await page.keyboard.press("Enter");
  }

  const typingIndicator = page
    .locator(
      '[data-testid*="typing"], .animate-pulse, [class*="typing"], [class*="loading"]'
    )
    .first();
  await typingIndicator.waitFor({ state: "visible", timeout: TYPING_INDICATOR_MAX_MS });
  const typingMs = Date.now() - sendStart;
  expect(typingMs, `Typing indicator must appear within ${TYPING_INDICATOR_MAX_MS}ms`).toBeLessThanOrEqual(TYPING_INDICATOR_MAX_MS);
  console.log(`[OK] Typing indicator at ${typingMs}ms`);

  const aiMessageText = page
    .locator(
      '[data-testid*="message"]:not([data-testid*="user"]), [class*="assistant"], [class*="ai-message"]'
    )
    .filter({ hasText: /[\u4e00-\u9fa5a-zA-Z]{10,}/ })
    .first();

  await aiMessageText.waitFor({ state: "visible", timeout: FIRST_CONTENT_MAX_MS });
  const contentMs = Date.now() - sendStart;
  expect(contentMs, `First content must appear within ${FIRST_CONTENT_MAX_MS}ms`).toBeLessThanOrEqual(FIRST_CONTENT_MAX_MS);
  console.log(`[OK] First visible AI content at ${contentMs}ms`);

  let prevLength = (await aiMessageText.textContent())?.length ?? 0;
  let growthPolls = 0;
  for (let i = 0; i < PROGRESSIVE_GROWTH_POLLS + 2; i++) {
    await page.waitForTimeout(PROGRESSIVE_POLL_INTERVAL_MS);
    const nowLength = (await aiMessageText.textContent())?.length ?? 0;
    if (nowLength - prevLength >= PROGRESSIVE_MIN_GROWTH_PER_POLL) {
      growthPolls++;
    }
    prevLength = nowLength;
  }
  expect(growthPolls, `Content must grow in at least ${PROGRESSIVE_GROWTH_POLLS} polling intervals (proves progressive streaming)`).toBeGreaterThanOrEqual(PROGRESSIVE_GROWTH_POLLS);
  console.log(`[OK] Progressive growth confirmed: ${growthPolls} growing intervals`);

  await page.waitForFunction(
    () => {
      const typingEls = Array.from(
        document.querySelectorAll('[data-testid*="typing"], .animate-pulse')
      );
      return typingEls.every((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width === 0 || rect.height === 0;
      });
    },
    { timeout: COMPLETION_MAX_MS }
  );
  const completionMs = Date.now() - sendStart;
  expect(completionMs, `Full response must complete within ${COMPLETION_MAX_MS}ms`).toBeLessThanOrEqual(COMPLETION_MAX_MS);
  console.log(`[OK] Response complete at ${completionMs}ms`);

  expect(managerChatCalled, "Chat must use /api/manager-chat endpoint (not vibe/build chat)").toBe(true);
  console.log("[OK] /api/manager-chat endpoint was called");
});
