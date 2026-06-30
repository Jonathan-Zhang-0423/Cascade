// DSL executor: translates a restricted JSON action sequence into Playwright calls.
// Only the safe subset of actions is supported — no page.evaluate(), no coordinates,
// no hard-coded sleeps. Single action failures are caught and logged; recording continues.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

// ─── DSL types ────────────────────────────────────────────────────────────────

export type DslBySelector =
  | { by: "role"; role: string; name?: string }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "label"; label: string }
  | { by: "placeholder"; placeholder: string }
  | { by: "selector"; selector: string };

export type DslAction =
  | ({ action: "waitFor" } & (
      | { selector: string; state?: "visible" | "hidden" | "attached" | "detached" }
      | { condition: string }
      | { loadState: "load" | "domcontentloaded" | "networkidle" }
    ))
  | ({ action: "click" } & DslBySelector)
  | ({ action: "fill" } & DslBySelector & { value: string })
  | ({ action: "press"; key: string })
  | ({ action: "hover" } & DslBySelector)
  | ({ action: "scroll"; deltaX?: number; deltaY?: number })
  | { action: "wait"; ms: number }; // capped at 3000ms — only for explicit pauses

const ACTION_TIMEOUT_MS = 8_000;
const MAX_WAIT_MS = 3_000;

// ─── Locator helper ───────────────────────────────────────────────────────────

function resolveLocator(page: Page, by: DslBySelector) {
  if (by.by === "role")        return page.getByRole(by.role, by.name ? { name: by.name } : undefined);
  if (by.by === "text")        return page.getByText(by.text, { exact: by.exact ?? false });
  if (by.by === "label")       return page.getByLabel(by.label);
  if (by.by === "placeholder") return page.getByPlaceholder(by.placeholder);
  if (by.by === "selector")    return page.locator(by.selector);
  throw new Error(`Unknown locator type`);
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export async function executeDslSequence(
  page: Page,
  actions: DslAction[],
): Promise<{ executed: number; failed: number; errors: string[] }> {
  let executed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const step of actions) {
    try {
      await withTimeout(runAction(page, step), ACTION_TIMEOUT_MS);
      executed++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${step.action}] ${msg}`);
      console.warn(`[dsl-executor] action failed, continuing: ${msg}`);
    }
  }

  return { executed, failed, errors };
}

async function runAction(page: Page, step: DslAction): Promise<void> {
  switch (step.action) {
    case "waitFor": {
      if ("selector" in step) {
        await page.waitForSelector(step.selector, { state: step.state ?? "visible", timeout: ACTION_TIMEOUT_MS });
      } else if ("condition" in step) {
        await page.waitForFunction(step.condition, { timeout: ACTION_TIMEOUT_MS });
      } else if ("loadState" in step) {
        await page.waitForLoadState(step.loadState, { timeout: ACTION_TIMEOUT_MS });
      }
      break;
    }
    case "click": {
      const locator = resolveLocator(page, step);
      await locator.first().click({ timeout: ACTION_TIMEOUT_MS });
      break;
    }
    case "fill": {
      const locator = resolveLocator(page, step);
      await locator.first().fill(step.value, { timeout: ACTION_TIMEOUT_MS });
      break;
    }
    case "press": {
      await page.keyboard.press(step.key);
      break;
    }
    case "hover": {
      const locator = resolveLocator(page, step);
      await locator.first().hover({ timeout: ACTION_TIMEOUT_MS });
      break;
    }
    case "scroll": {
      await page.mouse.wheel(step.deltaX ?? 0, step.deltaY ?? 200);
      break;
    }
    case "wait": {
      const ms = Math.min(step.ms, MAX_WAIT_MS);
      await new Promise<void>((r) => setTimeout(r, ms));
      break;
    }
    default: {
      // Unrecognised action — skip silently to stay forward-compatible
      break;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

// ─── Schema validation ────────────────────────────────────────────────────────

const ALLOWED_ACTIONS = new Set(["waitFor", "click", "fill", "press", "hover", "scroll", "wait"]);
const ALLOWED_BY = new Set(["role", "text", "label", "placeholder", "selector"]);

export function validateDslSequence(raw: unknown): DslAction[] {
  if (!Array.isArray(raw)) throw new Error("DSL must be a JSON array");
  const validated: DslAction[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const action = (item as Record<string, unknown>).action;
    if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) continue;
    if ("by" in item && !ALLOWED_BY.has((item as Record<string, unknown>).by as string)) continue;
    validated.push(item as DslAction);
  }
  return validated;
}
