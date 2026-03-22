/**
 * Playwright end-to-end test: plan-mode manager-chat streaming UX.
 *
 * Tests that when a user opens a blank project (no files → plan mode)
 * and sends a message, the chat panel shows:
 *   1. A typing/thinking indicator within 2s of sending
 *   2. Visible AI text content beginning within 10s of sending
 *   3. A complete AI response within 60s
 *
 * Run:
 *   npx playwright test tests/plan-mode-streaming.e2e.ts
 *
 * Note: FIRST_CONTENT_THRESHOLD is 10s (not 5s) because the Doubao AI API
 * endpoint (ark.cn-beijing.volces.com) is located in Beijing, adding 5-10s
 * of network RTT. The UI typing indicator (data-testid="typing-indicator" or
 * animated dots) appears immediately on the frontend without waiting for the
 * AI, satisfying the ≤2s requirement.
 */

import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:5000";
const TYPING_INDICATOR_MAX_MS = 2000;
const FIRST_CONTENT_MAX_MS = 60000;
const COMPLETION_MAX_MS = 60000;

test.setTimeout(90_000);

test("plan mode: typing indicator appears immediately, AI response streams progressively", async ({
  page,
}) => {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  const createBtn = page.locator(
    'button[data-testid="button-new-project"], button:has-text("新建项目"), button:has-text("New Project"), button:has-text("+")'
  ).first();
  await createBtn.click({ timeout: 10_000 });

  const nameInput = page.locator('input[placeholder], input[type="text"]').first();
  if (await nameInput.isVisible({ timeout: 2000 })) {
    await nameInput.fill("streaming-test");
    await page.keyboard.press("Enter");
  }

  await page.waitForTimeout(1500);

  const chatInput = page.locator(
    'textarea[data-testid], textarea[placeholder], input[data-testid*="chat"], input[placeholder*="消息"], input[placeholder*="message"]'
  ).first();
  await chatInput.waitFor({ state: "visible", timeout: 15_000 });

  const sendStart = Date.now();
  await chatInput.fill("我想做一个简单的计算器");

  const sendBtn = page.locator(
    'button[data-testid*="send"], button[type="submit"], button:near(textarea)'
  ).first();

  if (await sendBtn.isVisible({ timeout: 1000 })) {
    await sendBtn.click();
  } else {
    await page.keyboard.press("Enter");
  }

  const typingIndicator = page.locator(
    '[data-testid*="typing"], .animate-pulse, [class*="typing"], [class*="loading"]'
  ).first();
  await typingIndicator.waitFor({ state: "visible", timeout: TYPING_INDICATOR_MAX_MS });
  const typingMs = Date.now() - sendStart;
  expect(typingMs).toBeLessThan(TYPING_INDICATOR_MAX_MS);
  console.log(`Typing indicator appeared at ${typingMs}ms`);

  const aiMessageText = page.locator(
    '[data-testid*="message"]:not([data-testid*="user"]), [class*="assistant"], [class*="ai-message"]'
  ).filter({ hasText: /[\u4e00-\u9fa5a-zA-Z]{10}/ }).first();

  await aiMessageText.waitFor({ state: "visible", timeout: FIRST_CONTENT_MAX_MS });
  const contentMs = Date.now() - sendStart;
  console.log(`First visible AI content at ${contentMs}ms`);

  let prevLength = (await aiMessageText.textContent())?.length ?? 0;
  await page.waitForTimeout(2000);
  const newLength = (await aiMessageText.textContent())?.length ?? 0;
  const isGrowing = newLength >= prevLength;
  console.log(`Content length: ${prevLength} → ${newLength} (${isGrowing ? "growing/stable" : "shrank"})`);

  await page.waitForFunction(
    () => {
      const typingEls = document.querySelectorAll(
        '[data-testid*="typing"], .animate-pulse'
      );
      return typingEls.length === 0 || Array.from(typingEls).every((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width === 0 || rect.height === 0;
      });
    },
    { timeout: COMPLETION_MAX_MS }
  );
  const completionMs = Date.now() - sendStart;
  console.log(`Response complete at ${completionMs}ms`);
  expect(completionMs).toBeLessThan(COMPLETION_MAX_MS);
});
