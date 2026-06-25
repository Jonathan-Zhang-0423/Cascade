// DSL executor: translates a restricted JSON interaction script into Playwright calls.
// Designed for safe auto-execution: no page.evaluate(), no coordinates, no hard sleeps.
// Individual action failures are caught and logged — recording always continues.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

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
  | { action: "press"; key: string }
  | ({ action: "hover" } & DslBySelector)
  | { action: "scroll"; deltaX?: number; deltaY?: number }
  | { action: "wait"; ms: number };

const ACTION_TIMEOUT_MS = 8_000;
const MAX_WAIT_MS = 3_000;

function resolveLocator(page: Page, by: DslBySelector) {
  if (by.by === "role")        return page.getByRole(by.role, by.name ? { name: by.name } : undefined);
  if (by.by === "text")        return page.getByText(by.text, { exact: by.exact ?? false });
  if (by.by === "label")       return page.getByLabel(by.label);
  if (by.by === "placeholder") return page.getByPlaceholder(by.placeholder);
  if (by.by === "selector")    return page.locator(by.selector);
  throw new Error("Unknown locator type");
}

async function runAction(page: Page, step: DslAction): Promise<void> {
  switch (step.action) {
    case "waitFor":
      if ("selector" in step)
        await page.waitForSelector(step.selector, { state: step.state ?? "visible", timeout: ACTION_TIMEOUT_MS });
      else if ("condition" in step)
        await page.waitForFunction(step.condition, { timeout: ACTION_TIMEOUT_MS });
      else if ("loadState" in step)
        await page.waitForLoadState(step.loadState, { timeout: ACTION_TIMEOUT_MS });
      break;
    case "click":
      await resolveLocator(page, step).first().click({ timeout: ACTION_TIMEOUT_MS });
      break;
    case "fill":
      await resolveLocator(page, step).first().fill(step.value, { timeout: ACTION_TIMEOUT_MS });
      break;
    case "press":
      await page.keyboard.press(step.key);
      break;
    case "hover":
      await resolveLocator(page, step).first().hover({ timeout: ACTION_TIMEOUT_MS });
      break;
    case "scroll":
      await page.mouse.wheel(step.deltaX ?? 0, step.deltaY ?? 200);
      break;
    case "wait": {
      const ms = Math.min(step.ms, MAX_WAIT_MS);
      await new Promise<void>((r) => setTimeout(r, ms));
      break;
    }
  }
}

export async function executeDslSequence(
  page: Page,
  actions: DslAction[],
): Promise<{ executed: number; failed: number; errors: string[] }> {
  let executed = 0, failed = 0;
  const errors: string[] = [];
  for (const step of actions) {
    try {
      await Promise.race([
        runAction(page, step),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout`)), ACTION_TIMEOUT_MS + 1000)),
      ]);
      executed++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${step.action}] ${msg}`);
      console.warn(`[dsl-executor] step failed (continuing): ${msg}`);
    }
  }
  return { executed, failed, errors };
}

// ── Validation ───────────────────────────────────────────────────────────────

const ALLOWED_ACTIONS = new Set(["waitFor", "click", "fill", "press", "hover", "scroll", "wait"]);
const ALLOWED_BY = new Set(["role", "text", "label", "placeholder", "selector"]);
const FORBIDDEN_SELECTOR_PATTERNS = [/^#/, /^\./, /\[.*\]/, /^div/, /^span/, /^input/];

export interface DslValidationResult {
  valid: boolean;
  error?: string;
  actions?: DslAction[];
}

export function validateDslSequence(raw: unknown): DslValidationResult {
  if (!Array.isArray(raw)) {
    return { valid: false, error: "Script must be a JSON array." };
  }
  if (raw.length < 3) {
    return { valid: false, error: `Script has only ${raw.length} step(s); minimum is 3. Add more interactions to demonstrate the app's core features.` };
  }

  const first = raw[0] as Record<string, unknown>;
  if (!first || first.action !== "waitFor") {
    return { valid: false, error: "First step must be a waitFor action (e.g. { action: 'waitFor', loadState: 'networkidle' }) to ensure the app is loaded before interactions." };
  }

  for (let i = 0; i < raw.length; i++) {
    const step = raw[i] as Record<string, unknown>;
    if (!step || typeof step !== "object") continue;

    const action = step.action as string;
    if (!ALLOWED_ACTIONS.has(action)) {
      return { valid: false, error: `Step ${i + 1}: unknown action "${action}". Allowed: ${[...ALLOWED_ACTIONS].join(", ")}.` };
    }

    if ("by" in step) {
      const by = step.by as string;
      if (!ALLOWED_BY.has(by)) {
        return { valid: false, error: `Step ${i + 1}: selector type "${by}" is not allowed. Only semantic selectors are permitted: ${[...ALLOWED_BY].join(", ")}.` };
      }
      // Reject CSS-like selectors
      if (by === "selector" && typeof step.selector === "string") {
        const sel = step.selector as string;
        if (FORBIDDEN_SELECTOR_PATTERNS.some((p) => p.test(sel))) {
          return { valid: false, error: `Step ${i + 1}: CSS selector "${sel}" is not allowed. Use semantic selectors: getByRole, getByText, getByLabel, or getByPlaceholder.` };
        }
      }
    }
  }

  return { valid: true, actions: raw as DslAction[] };
}
